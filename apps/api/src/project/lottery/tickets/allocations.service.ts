import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  ALLOCATION_IN_EVENT_TYPES,
  ALLOCATION_OUT_EVENT_TYPES,
  type AllocationBookNet,
  TICKET_STATUS,
  allocationGivenOf,
} from "@repo/domain/project/lottery";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import {
  LotteryAllocationsRepository,
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { tenantOfOperator } from "../master-data-tenant";
import { notFoundError, validationError } from "./inventory-error";

/** 一家店 × 一個遊戲的預計要給本數與已給本數。 */
export interface AllocationStatus {
  orgId: string;
  gameId: string;
  /** 預計要給的本數;沒有設定 → null。 */
  plannedBooks: number | null;
  note: string | null;
  /** 已給:整本 N 本。 */
  givenBooks: number;
  /** 已給:零碎 N 張(「+N 張」)。 */
  givenExtraTickets: number;
}

export interface SetAllocationInput {
  orgId: Types.ObjectId;
  gameId: Types.ObjectId;
  plannedBooks: number;
  note?: string | null;
}

const AUDIT_ACTION = "lottery-allocation.edit";
const AUDIT_TARGET_TYPE = "lottery_allocation";

/**
 * 預計要給本數(專案規格 7.6;正本 `docs/modules/project/inventory.md`「資料與帳本」)。
 *
 * - 已給 = 進貨 + 調入 − 調出(累計、售出不扣),每本在這家店的淨張數 ≥ 可用張數算 1 本,否則「+N 張」;
 *   計算只有一份(`cellsOf`),以租戶邊界上下文讀整個租戶的事件(反查)
 * - `allocationStatus` / `allocationStatuses`:一家店 × 一或多個遊戲(叫貨單 / 進貨單 / 調貨單的「超過只警告」);
 *   分店在租戶裡即可,**權限與可見性由呼叫端判斷**(調貨的出貨店也要算得出收貨店的已給)
 * - `allocationMatrix`:多家店 × 多個遊戲(庫存管理的矩陣、遊戲詳情、乙類詳情);只回操作者看得到的分店
 * - `setAllocation`:新增或修改一筆(唯一 `(orgId, gameId)`),寫 audit_log;以操作者自己的範圍寫
 */
@Injectable()
export class LotteryAllocationsService {
  constructor(
    private readonly allocations: LotteryAllocationsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly orgs: OrgsRepository,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  async allocationStatus(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    gameId: Types.ObjectId,
  ): Promise<AllocationStatus> {
    const [status] = await this.allocationStatuses(operator, orgId, [gameId]);
    if (status === undefined) {
      throw notFoundError("遊戲不存在");
    }
    return status;
  }

  /**
   * 一家店 × 多個遊戲的預計要給本數與已給本數(叫貨單新增頁一次列出所有販售中的遊戲;規格 8.1)。
   * 回傳順序同 `gameIds`,沒有資料的遊戲補 0 列。分店只要在操作者當前組織的租戶裡
   * (出貨店也算得出收貨店的已給;**權限與可見性由呼叫端判斷**),走 `cellsOf`、不經過
   * `allocationMatrix` 的可見範圍防線。
   */
  async allocationStatuses(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    gameIds: readonly Types.ObjectId[],
  ): Promise<AllocationStatus[]> {
    const reader = await this.tenantReader(operator);
    if (
      reader.visibleOrgIds !== "all" &&
      !reader.visibleOrgIds.some((id) => id.equals(orgId))
    ) {
      throw notFoundError("分店不存在");
    }
    if (gameIds.length === 0) {
      return [];
    }
    const cells = await this.cellsOf(reader, [orgId], gameIds);
    return gameIds.map(
      (gameId) =>
        cells.find((cell) => cell.gameId === String(gameId)) ?? {
          orgId: String(orgId),
          gameId: String(gameId),
          plannedBooks: null,
          note: null,
          givenBooks: 0,
          givenExtraTickets: 0,
        },
    );
  }

  /**
   * 多家店 × 多個遊戲一次算(庫存管理的矩陣、遊戲詳情、乙類詳情):只回有設定預計或已給 > 0 的格子。
   * `gameIds` 不給 = 全部遊戲。操作者看不到的分店直接略過(不回)。
   */
  async allocationMatrix(
    operator: OperatorContext,
    orgIds: readonly Types.ObjectId[],
    gameIds?: readonly Types.ObjectId[],
  ): Promise<AllocationStatus[]> {
    // 防線:只回操作者看得到的分店(讀用租戶邊界上下文,可見範圍要在這裡收窄)
    const visible = orgIds.filter((orgId) => isOrgVisible(operator, orgId));
    if (visible.length === 0) {
      return [];
    }
    const reader = await this.tenantReader(operator);
    return this.cellsOf(reader, visible, gameIds);
  }

  /** 操作者當前組織所在租戶的邊界上下文(整個租戶的事件;反查)。 */
  private async tenantReader(
    operator: OperatorContext,
  ): Promise<OperatorContext> {
    const tenant = tenantOfOperator(operator);
    if (tenant?.tenantId == null) {
      throw notFoundError("找不到所在租戶");
    }
    return tenantBoundaryContext(this.orgs, operator, tenant.tenantId);
  }

  private async cellsOf(
    reader: OperatorContext,
    orgIds: readonly Types.ObjectId[],
    gameIds?: readonly Types.ObjectId[],
  ): Promise<AllocationStatus[]> {
    const inTypes = [...ALLOCATION_IN_EVENT_TYPES];
    const outTypes = [...ALLOCATION_OUT_EVENT_TYPES];
    const gameFilter =
      gameIds === undefined ? {} : { gameId: { $in: [...gameIds] } };
    const perBook = await this.events.aggregate(reader, [
      {
        $match: {
          orgId: { $in: [...orgIds] },
          ...gameFilter,
          type: { $in: [...inTypes, ...outTypes] },
        },
      },
      {
        $group: {
          _id: { orgId: "$orgId", gameId: "$gameId", bookId: "$bookId" },
          net: {
            $sum: { $cond: [{ $in: ["$type", inTypes] }, 1, -1] },
          },
        },
      },
    ]);
    const bookIds = [
      ...new Map(
        perBook.map((row) => {
          const id = (row._id as { bookId: Types.ObjectId }).bookId;
          return [String(id), id] as const;
        }),
      ).values(),
    ];
    const books =
      bookIds.length === 0
        ? []
        : await this.books.findMany(
            reader,
            { _id: { $in: bookIds }, status: "normal" },
            { select: "standardTickets" },
          );
    // 跳號的張實體不存在:這家店進貨時算進去的跳號要扣掉
    const skipped =
      bookIds.length === 0
        ? []
        : await this.tickets.aggregate(reader, [
            {
              $match: {
                bookId: { $in: bookIds },
                orgId: { $in: [...orgIds] },
                status: TICKET_STATUS.skipped,
              },
            },
            {
              $group: {
                _id: { bookId: "$bookId", orgId: "$orgId" },
                count: { $sum: 1 },
              },
            },
          ]);
    const standardOf = new Map(
      books.map((book) => [String(book._id), book.standardTickets]),
    );
    const skippedOf = new Map(
      skipped.map((row) => {
        const id = row._id as { bookId: Types.ObjectId; orgId: Types.ObjectId };
        return [`${String(id.orgId)}:${String(id.bookId)}`, Number(row.count)];
      }),
    );
    const netsOf = new Map<string, AllocationBookNet[]>();
    for (const row of perBook) {
      const id = row._id as {
        orgId: Types.ObjectId;
        gameId: Types.ObjectId;
        bookId: Types.ObjectId;
      };
      const usableTickets = standardOf.get(String(id.bookId));
      if (usableTickets === undefined) {
        continue;
      }
      const key = `${String(id.orgId)}:${String(id.gameId)}`;
      const nets = netsOf.get(key) ?? [];
      nets.push({
        netTickets:
          Number(row.net) -
          (skippedOf.get(`${String(id.orgId)}:${String(id.bookId)}`) ?? 0),
        usableTickets,
      });
      netsOf.set(key, nets);
    }
    const allocations = await this.allocations.findMany(reader, {
      orgId: { $in: [...orgIds] },
      ...gameFilter,
    });
    const cells = new Map<string, AllocationStatus>();
    const cellOf = (orgId: string, gameId: string): AllocationStatus => {
      const key = `${orgId}:${gameId}`;
      const existing = cells.get(key);
      if (existing) {
        return existing;
      }
      const created: AllocationStatus = {
        orgId,
        gameId,
        plannedBooks: null,
        note: null,
        givenBooks: 0,
        givenExtraTickets: 0,
      };
      cells.set(key, created);
      return created;
    };
    for (const [key, nets] of netsOf) {
      const given = allocationGivenOf(nets);
      if (given.books === 0 && given.extraTickets === 0) {
        continue;
      }
      const [orgId = "", gameId = ""] = key.split(":");
      const cell = cellOf(orgId, gameId);
      cell.givenBooks = given.books;
      cell.givenExtraTickets = given.extraTickets;
    }
    for (const allocation of allocations) {
      const cell = cellOf(String(allocation.orgId), String(allocation.gameId));
      cell.plannedBooks = allocation.plannedBooks;
      cell.note = allocation.note;
    }
    return [...cells.values()];
  }

  async setAllocation(
    operator: OperatorContext,
    input: SetAllocationInput,
  ): Promise<void> {
    if (!Number.isInteger(input.plannedBooks) || input.plannedBooks < 0) {
      throw validationError("預計要給本數要是 0 以上的整數", ["plannedBooks"]);
    }
    const note = input.note?.trim() ? input.note.trim() : null;
    await this.transactions.withTransaction(async () => {
      const existing = await this.allocations.findOne(operator, {
        orgId: input.orgId,
        gameId: input.gameId,
      });
      if (existing) {
        await this.allocations.updateById(operator, existing._id, {
          $set: { plannedBooks: input.plannedBooks, note },
        });
        await this.audit.record(operator, {
          action: AUDIT_ACTION,
          targetType: AUDIT_TARGET_TYPE,
          targetId: existing._id,
          before: { plannedBooks: existing.plannedBooks, note: existing.note },
          after: { plannedBooks: input.plannedBooks, note },
        });
        return;
      }
      const created = await this.allocations.create(operator, {
        orgId: input.orgId,
        gameId: input.gameId,
        plannedBooks: input.plannedBooks,
        note,
      });
      await this.audit.record(operator, {
        action: AUDIT_ACTION,
        targetType: AUDIT_TARGET_TYPE,
        targetId: created._id,
        after: {
          orgId: String(input.orgId),
          gameId: String(input.gameId),
          plannedBooks: input.plannedBooks,
          note,
        },
      });
    });
  }
}
