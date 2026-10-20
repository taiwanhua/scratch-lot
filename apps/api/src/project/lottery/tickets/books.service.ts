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
import { systemTenantReader } from "../../../database/system-tenant-reader";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  type LotteryBookDocument,
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import {
  INVENTORY_REASONS,
  notFoundError,
  validationError,
} from "./inventory-error";
import { snapshotOf } from "./ticket-ledger.service";

type BookRecord = Persisted<LotteryBookDocument>;

/** `createBook` 的輸入(進貨點收一本;P18 呼叫)。 */
export interface CreateBookInput {
  /** 租戶頂層 id。 */
  tenantId: Types.ObjectId;
  /** 點收的分店(這本的所在分店)。 */
  storeOrgId: Types.ObjectId;
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
  /** 點收人(進貨事件的「誰」)。 */
  by: Types.ObjectId | null;
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
 * 本(專案規格 7.1;正本 `docs/modules/project/inventory.md`「資料與帳本」)。
 *
 * - `createBook`:**只給進貨點收用**。本號補 0、本編號、迄號範圍、起號 001、建立全部的張(跳號待拆本時標註)、
 *   單張成本 = 成本 ÷ 標準張數,每張寫一筆「進貨」事件(版本 1);在呼叫端的交易裡
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
    input: CreateBookInput,
  ): Promise<{ book: BookRecord; pendingSkipCount: number }> {
    const ledger = await systemTenantReader(this.orgs, input.tenantId);
    const game = await this.games.findOne(
      ledger,
      { _id: input.gameId, tenantId: input.tenantId },
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
    const visible = ledger.visibleOrgIds;
    if (
      visible !== "all" &&
      !visible.some((orgId) => orgId.equals(input.storeOrgId))
    ) {
      throw validationError("點收分店不在這個租戶", ["storeOrgId"]);
    }
    const bookKey = bookKeyOf(game.gameCode, bookNo);
    if (
      await this.books.existsInTenant(
        ledger,
        input.tenantId,
        "bookKey",
        bookKey,
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
      ledger,
      {
        orgId: input.tenantId,
        gameId: game._id,
        gameCode: game.gameCode,
        bookNo,
        bookKey,
        printVersion: input.printVersion ?? "1",
        storeOrgId: input.storeOrgId,
        holderOrgIds: [input.storeOrgId],
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
    // 跳號的張實體不存在、不算成本:單張成本以標準張數分攤
    const unitCost = cost / standardTickets;
    const at = input.at ?? new Date();
    for (let number = 1; number <= input.lastTicketNo; number += 1) {
      const ticketNo = formatTicketNo(number);
      const ticket = await this.tickets.create(
        ledger,
        {
          orgId: input.tenantId,
          bookId: book._id,
          gameId: game._id,
          bookNo,
          ticketNo,
          ticketKey: ticketKeyOf(game.gameCode, bookNo, ticketNo),
          storeOrgId: input.storeOrgId,
          status: TICKET_STATUS.unsold,
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
          lockedBy: null,
          responsibleOrgId: null,
          unitCost,
          version: 1,
        },
        { session },
      );
      await this.events.create(
        ledger,
        {
          orgId: input.storeOrgId,
          eventId: ticketEventIdOf(String(ticket._id), 1),
          ticketId: ticket._id,
          bookId: book._id,
          gameId: game._id,
          at,
          by: input.by,
          type: TICKET_EVENT_TYPE.purchase,
          from: null,
          to: snapshotOf(ticket),
          quantity: 1,
          amount: 0,
          cashEffect: "none",
          refType: input.purchaseSubmissionId ? "purchase" : null,
          refId: input.purchaseSubmissionId ?? null,
        },
        { session },
      );
    }
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
   * 讀得到才以租戶系統身分讀這本全部的張來算(各分店持有要看整本)。讀不到 → `NOT_FOUND`。
   */
  async statsOf(
    operator: OperatorContext,
    bookId: Types.ObjectId,
  ): Promise<BookStats> {
    const book = await this.books.findById(operator, bookId);
    if (!book?.tenantId) {
      throw notFoundError("本不存在");
    }
    const ledger = await systemTenantReader(this.orgs, book.tenantId);
    const tickets = await this.tickets.findMany(
      ledger,
      { bookId: book._id },
      { select: "status location storeOrgId" },
    );
    const snapshots = tickets.map((ticket) => ({
      status: ticket.status,
      locationKind: ticket.location.kind,
      storeOrgId: String(ticket.storeOrgId),
    }));
    return {
      pendingSkipCount: pendingSkipCountOf(
        Number(book.lastTicketNo),
        book.standardTickets,
        book.skippedTicketNos.length,
      ),
      remainingCount: remainingCountOf(snapshots),
      totalCount: snapshots.filter(
        (ticket) => ticket.status !== TICKET_STATUS.skipped,
      ).length,
      holdings: [...holdingsOf(snapshots)].map(([orgId, count]) => ({
        orgId,
        count,
      })),
      state: bookStateOf(snapshots),
    };
  }
}
