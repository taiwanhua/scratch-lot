import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  type BookState,
  LAST_TICKET_NO_MAX,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  bookKeyOf,
  bookStateOf,
  formatTicketNo,
  holdingsOf,
  normalizeBookNo,
  pendingSkipCountOf,
  remainingCountOf,
  ticketEventIdOf,
  ticketKeyOf,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  type LotteryBookDocument,
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { tenantOfOperator } from "../master-data-tenant";
import {
  INVENTORY_REASONS,
  notFoundError,
  validationError,
} from "./inventory-error";
import { snapshotOf } from "./ticket-ledger.service";

type BookRecord = Persisted<LotteryBookDocument>;

/** `createBook` 的輸入(進貨點收一本;P18 呼叫)。 */
export interface CreateBookInput {
  /** 點收的分店(這本的所在分店;要在操作者的可見範圍內)。 */
  orgId: Types.ObjectId;
  gameId: Types.ObjectId;
  /** 本號:6 位(自動補 0)或 7 位。 */
  bookNo: string;
  /** 印刷版別;不給 = "1"。 */
  printVersion?: string;
  /** 迄號:≥ 標準張數且 ≤ 999。 */
  lastTicketNo: number;
  /** 批購金額率(整數 %;小數四捨五入)。 */
  rate: number;
  /** 成本(元;小數四捨五入)。 */
  cost: number;
  purchaseSubmissionId?: Types.ObjectId | null;
  purchasedAt?: Date | null;
  purchaseDealerId?: Types.ObjectId | null;
  /** 點收時間;不給 = 現在。 */
  at?: Date;
}

/** 本的即時計算(規格 7.1:不存)。 */
export interface BookStats {
  pendingSkipCount: number;
  remainingCount: number;
  totalCount: number;
  /** 各分店持有張數(不算跳號)。 */
  holdings: { orgId: string; count: number }[];
  state: BookState;
}

/**
 * 單張成本 = 成本 ÷ 標準張數(跳號的張實體不存在、不算成本)。**不四捨五入**:存除出來的值,
 * 一本的單張成本加總 = 這本的成本;報表加總單張成本後再四捨五入到元。
 */
export function unitCostOf(cost: number, standardTickets: number): number {
  return cost / standardTickets;
}

/**
 * 待標註的跳號(拆本前還沒標的)實體不存在,不算張數(使用者 10/27 定案甲):整本一起的一組張
 * (張數 = 標準張數 + 待標註,例:未拆的本在某家店的持有、未拆整本待查)扣掉待標註;其他照算。
 * 例:迄號 101、標準 100、未拆 → 101 張紀錄算 100 張。
 */
export function withoutPendingSkips(
  count: number,
  standardTickets: number,
  pendingSkipCount: number,
): number {
  return pendingSkipCount > 0 && count === standardTickets + pendingSkipCount
    ? count - pendingSkipCount
    : count;
}

/**
 * 本(專案規格 7.1;正本 `docs/modules/project/inventory.md`「資料與帳本」)。
 *
 * - `createBook`:**只給進貨點收用**,以點收人(操作者)自己的範圍寫。本號補 0、本編號、迄號範圍、起號 001、
 *   一次建立全部的張(跳號待拆本時標註)與每張一筆「進貨」事件(版本 1);在呼叫端的交易裡
 * - `statsOf`:待標註、剩餘、各分店持有、未拆 / 檯面中 / 售完(即時計算)
 */
@Injectable()
export class LotteryBooksService {
  constructor(
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  async createBook(
    session: ClientSession,
    operator: OperatorContext,
    input: CreateBookInput,
  ): Promise<{ book: BookRecord; pendingSkipCount: number }> {
    const tenant = tenantOfOperator(operator);
    if (tenant?.tenantId == null) {
      throw notFoundError("找不到所在租戶");
    }
    // 遊戲是全租戶共用的主檔(資料共用 wholeTenant),點收人讀得到
    const game = await this.games.findOne(
      operator,
      { _id: input.gameId },
      { session },
    );
    if (!game) {
      throw notFoundError("遊戲不存在");
    }
    const bookNo = normalizeBookNo(input.bookNo);
    if (bookNo === null) {
      throw validationError("本號要 6 或 7 位數字", ["bookNo"]);
    }
    const standardTickets = game.ticketsPerBook;
    if (
      !Number.isInteger(input.lastTicketNo) ||
      input.lastTicketNo < standardTickets ||
      input.lastTicketNo > LAST_TICKET_NO_MAX
    ) {
      throw validationError(
        `迄號要在 ${String(standardTickets)} 到 ${String(LAST_TICKET_NO_MAX)} 之間`,
        ["lastTicketNo"],
        INVENTORY_REASONS.lastTicketNoOutOfRange,
      );
    }
    // 本編號的租戶 = 點收分店的租戶:點收分店要在操作者當前組織的租戶裡(同時屬於兩個租戶的人
    // 不能拿甲租戶的身分點收到乙租戶的店;反查整個租戶的組織樹)
    const tenantTree = await tenantBoundaryContext(
      this.orgs,
      operator,
      tenant.tenantId,
    );
    if (
      tenantTree.visibleOrgIds !== "all" &&
      !tenantTree.visibleOrgIds.some((id) => id.equals(input.orgId))
    ) {
      throw validationError(
        "點收分店不在目前組織的租戶",
        ["orgId"],
        INVENTORY_REASONS.storeOutsideTenant,
      );
    }
    const bookKey = bookKeyOf(game.gameCode, bookNo);
    if (
      await this.books.existsInTenant(
        operator,
        tenant.tenantId,
        { bookKey },
        { session },
      )
    ) {
      throw validationError(
        "這本已經點收過",
        ["bookNo"],
        INVENTORY_REASONS.bookKeyDuplicate,
      );
    }
    const cost = Math.round(input.cost);
    const book = await this.books.create(
      operator,
      {
        orgId: input.orgId,
        gameId: game._id,
        gameCode: game.gameCode,
        bookNo,
        bookKey,
        printVersion: input.printVersion ?? "1",
        holderOrgIds: [input.orgId],
        purchaseSubmissionId: input.purchaseSubmissionId ?? null,
        purchasedAt: input.purchasedAt ?? null,
        purchaseDealerId: input.purchaseDealerId ?? null,
        rate: Math.round(input.rate),
        cost,
        standardTickets,
        firstTicketNo: formatTicketNo(1),
        lastTicketNo: formatTicketNo(input.lastTicketNo),
        skippedTicketNos: [],
        lockedTicketCount: 0,
        status: "normal",
      },
      { session },
    );
    const unitCost = unitCostOf(cost, standardTickets);
    const tickets = await this.tickets.createMany(
      operator,
      Array.from({ length: input.lastTicketNo }, (_, index) => {
        const ticketNo = formatTicketNo(index + 1);
        return {
          orgId: input.orgId,
          bookId: book._id,
          gameId: game._id,
          bookNo,
          ticketNo,
          ticketKey: ticketKeyOf(game.gameCode, bookNo, ticketNo),
          status: TICKET_STATUS.unsold,
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
          lockedBy: null,
          responsibleOrgId: null,
          unitCost,
          version: 1,
        };
      }),
      { session },
    );
    const at = input.at ?? new Date();
    await this.events.createMany(
      operator,
      tickets.map((ticket) => ({
        orgId: input.orgId,
        eventId: ticketEventIdOf(String(ticket._id), 1),
        ticketId: ticket._id,
        bookId: book._id,
        gameId: game._id,
        at,
        by: operator.actorId,
        type: TICKET_EVENT_TYPE.purchase,
        from: null,
        to: snapshotOf(ticket),
        quantity: 1,
        amount: 0,
        cost: unitCost,
        cashEffect: "none" as const,
        refType: input.purchaseSubmissionId ? "purchase" : null,
        refId: input.purchaseSubmissionId ?? null,
      })),
      { session },
    );
    return {
      book,
      pendingSkipCount: pendingSkipCountOf(
        input.lastTicketNo,
        standardTickets,
        0,
      ),
    };
  }

  /**
   * 本的即時計算。本以操作者自己的範圍讀(讀取放行:所在分店或持有任何一張的分店看得到),
   * 讀得到才以租戶邊界上下文讀這本全部的張(各分店持有要看整本;反查)。讀不到 → `NOT_FOUND`。
   */
  async statsOf(
    operator: OperatorContext,
    bookId: Types.ObjectId,
  ): Promise<BookStats> {
    const book = await this.books.findById(operator, bookId);
    if (!book?.tenantId) {
      throw notFoundError("本不存在");
    }
    const whole = await tenantBoundaryContext(
      this.orgs,
      operator,
      book.tenantId,
    );
    const tickets = await this.tickets.findMany(
      whole,
      { bookId: book._id },
      { select: "status location orgId" },
    );
    const snapshots = tickets.map((ticket) => ({
      status: ticket.status,
      locationKind: ticket.location.kind,
      storeOrgId: String(ticket.orgId),
    }));
    const pendingSkipCount = pendingSkipCountOf(
      Number(book.lastTicketNo),
      book.standardTickets,
      book.skippedTicketNos.length,
    );
    return {
      pendingSkipCount,
      remainingCount: remainingCountOf(snapshots, pendingSkipCount),
      totalCount: withoutPendingSkips(
        snapshots.filter((ticket) => ticket.status !== TICKET_STATUS.skipped)
          .length,
        book.standardTickets,
        pendingSkipCount,
      ),
      holdings: [...holdingsOf(snapshots)].map(([orgId, count]) => ({
        orgId,
        count: withoutPendingSkips(
          count,
          book.standardTickets,
          pendingSkipCount,
        ),
      })),
      state: bookStateOf(snapshots),
    };
  }
}
