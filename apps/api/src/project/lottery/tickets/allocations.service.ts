import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  ALLOCATION_IN_EVENT_TYPES,
  ALLOCATION_OUT_EVENT_TYPES,
  TICKET_STATUS,
  allocationGivenOf,
} from "@repo/domain/project/lottery";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
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
 * - `allocationStatus`:已給 = 進貨 + 調入 − 調出(累計、售出不扣),每本在這家店的淨張數
 *   ≥ 可用張數算 1 本,否則「+N 張」;給叫貨單 / 進貨單 / 調貨單的「超過只警告」與庫存管理的矩陣。
 *   **權限由呼叫端判斷**;這裡以租戶系統身分讀整個租戶的事件(調貨的出貨店也要算得出收貨店的已給)
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
   * 規則同 `allocationStatus`;回傳順序同 `gameIds`。
   */
  async allocationStatuses(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    gameIds: readonly Types.ObjectId[],
  ): Promise<AllocationStatus[]> {
    const tenant = tenantOfOperator(operator);
    if (tenant?.tenantId == null) {
      throw notFoundError("找不到所在租戶");
    }
    // 整個租戶的事件(出貨店也要算得出收貨店的已給;反查)
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      tenant.tenantId,
    );
    if (
      reader.visibleOrgIds !== "all" &&
      !reader.visibleOrgIds.some((id) => id.equals(orgId))
    ) {
      throw notFoundError("分店不存在");
    }
    if (gameIds.length === 0) {
      return [];
    }
    const inTypes = [...ALLOCATION_IN_EVENT_TYPES];
    const outTypes = [...ALLOCATION_OUT_EVENT_TYPES];
    const perBook = await this.events.aggregate(reader, [
      {
        $match: {
          orgId,
          gameId: { $in: [...gameIds] },
          type: { $in: [...inTypes, ...outTypes] },
        },
      },
      {
        $group: {
          _id: "$bookId",
          gameId: { $first: "$gameId" },
          net: {
            $sum: { $cond: [{ $in: ["$type", inTypes] }, 1, -1] },
          },
        },
      },
    ]);
    const bookIds = perBook.map((row) => row._id as Types.ObjectId);
    const books =
      bookIds.length === 0
        ? []
        : await this.books.findMany(
            reader,
            { _id: { $in: bookIds }, status: "normal" },
            { select: "standardTickets gameId" },
          );
    // 跳號的張實體不存在:這家店進貨時算進去的跳號要扣掉
    const skipped =
      bookIds.length === 0
        ? []
        : await this.tickets.aggregate(reader, [
            {
              $match: {
                bookId: { $in: bookIds },
                orgId,
                status: TICKET_STATUS.skipped,
              },
            },
            { $group: { _id: "$bookId", count: { $sum: 1 } } },
          ]);
    const skippedOf = new Map(
      skipped.map((row) => [String(row._id), Number(row.count)]),
    );
    const netOf = new Map(
      perBook.map((row) => [String(row._id), Number(row.net)]),
    );
    const allocations = await this.allocations.findMany(reader, {
      orgId,
      gameId: { $in: [...gameIds] },
    });
    return gameIds.map((gameId) => {
      const given = allocationGivenOf(
        books
          .filter((book) => book.gameId.equals(gameId))
          .map((book) => ({
            netTickets:
              (netOf.get(String(book._id)) ?? 0) -
              (skippedOf.get(String(book._id)) ?? 0),
            usableTickets: book.standardTickets,
          })),
      );
      const allocation = allocations.find((row) => row.gameId.equals(gameId));
      return {
        orgId: String(orgId),
        gameId: String(gameId),
        plannedBooks: allocation?.plannedBooks ?? null,
        note: allocation?.note ?? null,
        givenBooks: given.books,
        givenExtraTickets: given.extraTickets,
      };
    });
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
