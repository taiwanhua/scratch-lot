import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  isSealedInStore,
  splitPlanProblemOf,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { countsOfBook, pendingSkipCountOfBook } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type {
  MoveLotteryTicketsInput,
  RecallLotteryTicketsInput,
  SplitLotteryBookInput,
} from "./dto/lottery-store-sales.input";
import type { LotteryStoreStockBookModel } from "./models/lottery-store-sales.model";
import { parseId } from "./shift-views";
import { StoreAccess } from "./store-access";
import { StoreClock } from "./store-clock";
import { notFoundError, validationError } from "./store-error";
import {
  bookAlreadyOpenedError,
  notOnCounterError,
  splitPlanInvalidError,
} from "./store-sales-error";
import { StoreSalesSupport } from "./store-sales-support";
import { ticketRefsOf } from "./store-sales.service";

/**
 * 拆本、移櫃、收回(專案規格 6.4、3.3;正本 `docs/modules/project/store.md`「銷售與拆本」):
 *
 * - **拆本 / 上檯面**(`store.split`):本店庫存的張放上檯面。從沒拆過的本 → ① 標跳號(剛好待標註張數)
 *   ② 每一張放到一個收銀點;拆過的本只有 ②(只分配庫存的張)。寫「跳號」與「拆本」事件(時間軸第一次寫
 *   「拆本」、之後寫「上檯面」)。拆本時分放到多個收銀點算拆本,不需要 `store.move`
 * - **移櫃 / 收回**(`store.move`):檯面上未售的張移到別的收銀點 / 收回庫存;一律寫事件(誰、時間、從哪到哪)、
 *   不需審核
 *
 * 張的狀態與事件一律經帳本(條件更新,同一個交易)。
 */
@Injectable()
export class StoreCounterService {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly ledger: TicketLedgerService,
    private readonly transactions: TransactionService,
    private readonly support: StoreSalesSupport,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  /**
   * 拆本 / 上檯面「先選本」:本店有未售、在庫存、沒被鎖的張的本(使用者 10/27 定案 D:拆本 = 把本店庫存的張
   * 放上檯面;被調貨單鎖住的張不算,全部鎖住的本不列),依遊戲代號、本號排序。`sealed` = 這家店原封不動
   * (從沒拆過、這家店的張全是未售在庫存;標「未拆」,要標跳號、張數扣待標註);其他標「拆過 · 庫存 N 張」,
   * 不標跳號、張數照庫存的張(待標註保留,之後在本的詳情 [標跳號] 補標)。
   */
  async stockBooks(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreStockBookModel[]> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const rows = await this.tickets.aggregate(operator, [
      {
        $match: { orgId: store.orgId, status: { $ne: TICKET_STATUS.skipped } },
      },
      {
        $group: {
          _id: "$bookId",
          total: { $sum: 1 },
          inStock: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", TICKET_STATUS.unsold] },
                    { $eq: ["$location.kind", TICKET_LOCATION_KIND.stock] },
                    { $eq: [{ $ifNull: ["$lockedBy", null] }, null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $match: { inStock: { $gt: 0 } } },
    ]);
    if (rows.length === 0) {
      return [];
    }
    const rowOf = new Map(
      rows.map((row) => [
        String(row._id),
        { total: Number(row.total), inStock: Number(row.inStock) },
      ]),
    );
    const books = await this.books.findMany(operator, {
      _id: { $in: rows.map((row) => row._id as Types.ObjectId) },
      status: "normal",
    });
    const games = await this.support.gamesOf(
      operator,
      books.map((book) => book.gameId),
    );
    return books
      .map((book) => {
        const game = games.get(String(book.gameId));
        const row = rowOf.get(String(book._id)) ?? { total: 0, inStock: 0 };
        const sealed =
          row.total === row.inStock &&
          isSealedInStore(
            {
              counts: countsOfBook(book),
              firstOpenedAt: book.firstOpenedAt ?? null,
            },
            row.total,
          );
        const pendingSkipCount = sealed ? pendingSkipCountOfBook(book) : 0;
        return {
          bookId: String(book._id),
          gameCode: book.gameCode,
          gameName: game?.name ?? "",
          unitPrice: game?.unitPrice ?? 0,
          bookNo: book.bookNo,
          firstTicketNo: book.firstTicketNo,
          lastTicketNo: book.lastTicketNo,
          // 未拆的本:待標註的跳號(拆本前還沒標的)實體不存在,不算張數(使用者 10/27 定案甲)
          ticketCount: Math.max(0, row.inStock - pendingSkipCount),
          pendingSkipCount,
          sealed,
        };
      })
      .toSorted(
        (a, b) =>
          a.gameCode.localeCompare(b.gameCode) ||
          a.bookNo.localeCompare(b.bookNo),
      );
  }

  /**
   * 拆本 / 上檯面:把這本在本店庫存、未售、沒被鎖的張放到收銀點檯面(寫「拆本」事件;帳本在第一次寫
   * `firstOpenedAt`)。這家店原封不動的本照原流程先標跳號(剛好待標註張數);其他(拆過、只尋回幾張…)
   * 不標跳號,待標註保留(使用者 10/27 定案 M1)。
   * 本店沒有可放的庫存張 → `BOOK_ALREADY_OPENED`(清單已過時)。
   */
  async split(
    operator: OperatorContext,
    input: SplitLotteryBookInput,
  ): Promise<number> {
    const store = await this.support.mustStore(operator, input.orgId);
    const bookId = parseId(input.bookId);
    const book =
      bookId === null ? null : await this.books.findById(operator, bookId);
    if (book === null) {
      throw notFoundError(`book not found: ${input.bookId}`);
    }
    const pointIds = new Map<string, Types.ObjectId>();
    for (const assignment of input.assignments) {
      const point = await this.support.mustCashPoint(
        operator,
        store.orgId,
        assignment.cashPointId,
        "assignments",
      );
      pointIds.set(assignment.cashPointId, point._id);
    }
    return this.transactions.withTransaction(async (session) => {
      const mine = await this.tickets.findMany(
        operator,
        {
          bookId: book._id,
          orgId: store.orgId,
          status: { $ne: TICKET_STATUS.skipped },
        },
        { session },
      );
      const usable = mine.filter(
        (ticket) =>
          ticket.status === TICKET_STATUS.unsold &&
          ticket.location.kind === TICKET_LOCATION_KIND.stock &&
          ticket.lockedBy === null,
      );
      if (usable.length === 0 || book.status !== "normal") {
        throw bookAlreadyOpenedError();
      }
      // 這家店原封不動(從沒拆過、這家店的張全是未售在庫存、沒被鎖)才標跳號
      const sealed =
        usable.length === mine.length &&
        isSealedInStore(
          {
            counts: countsOfBook(book),
            firstOpenedAt: book.firstOpenedAt ?? null,
          },
          mine.length,
        );
      const pending = sealed ? pendingSkipCountOfBook(book) : 0;
      const problem = splitPlanProblemOf(
        usable.map((ticket) => ticket.ticketNo),
        pending,
        input.skippedTicketNos,
        input.assignments,
      );
      if (problem !== null) {
        throw splitPlanInvalidError(problem);
      }
      const byNo = new Map(usable.map((ticket) => [ticket.ticketNo, ticket]));
      const at = this.clock.now();
      const skipped = new Set(input.skippedTicketNos);
      const events: TicketEventInput[] = [];
      for (const no of skipped) {
        const ticket = byNo.get(no);
        if (ticket !== undefined) {
          events.push({
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            expectedStatuses: [TICKET_STATUS.unsold],
            type: TICKET_EVENT_TYPE.skip,
            at,
            patch: { status: TICKET_STATUS.skipped },
          });
        }
      }
      for (const assignment of input.assignments) {
        const cashPointId = pointIds.get(assignment.cashPointId) ?? null;
        for (const no of assignment.ticketNos) {
          const ticket = byNo.get(no);
          if (ticket !== undefined && cashPointId !== null) {
            events.push({
              ticketId: ticket._id,
              expectedVersion: ticket.version,
              expectedStatuses: [TICKET_STATUS.unsold],
              type: TICKET_EVENT_TYPE.open,
              at,
              patch: {
                location: { kind: TICKET_LOCATION_KIND.counter, cashPointId },
              },
              cashPointId,
            });
          }
        }
      }
      await this.ledger.applyTicketEvents(session, { operator }, events);
      await this.support.publish(store);
      return events.length;
    });
  }

  /** 移櫃:檯面上未售的張移到這家店另一個收銀點。 */
  async move(
    operator: OperatorContext,
    input: MoveLotteryTicketsInput,
  ): Promise<number> {
    const store = await this.support.mustStore(operator, input.orgId);
    const target = await this.support.mustCashPoint(
      operator,
      store.orgId,
      input.toCashPointId,
      "toCashPointId",
    );
    return this.counterEvents(operator, store, input, (ticket) => {
      if (ticket.location.cashPointId?.equals(target._id) === true) {
        throw validationError("already on this cash point", ["toCashPointId"]);
      }
      return {
        type: TICKET_EVENT_TYPE.move,
        patch: {
          location: {
            kind: TICKET_LOCATION_KIND.counter,
            cashPointId: target._id,
          },
        },
        cashPointId: target._id,
      };
    });
  }

  /** 收回:檯面上未售的張回到庫存。 */
  recall(
    operator: OperatorContext,
    input: RecallLotteryTicketsInput,
  ): Promise<number> {
    return this.support.mustStore(operator, input.orgId).then((store) =>
      this.counterEvents(operator, store, input, (ticket) => ({
        type: TICKET_EVENT_TYPE.recall,
        patch: {
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
        },
        cashPointId: ticket.location.cashPointId ?? null,
      })),
    );
  }

  private async counterEvents(
    operator: OperatorContext,
    store: { orgId: Types.ObjectId; tenantId: Types.ObjectId | null },
    input: RecallLotteryTicketsInput,
    eventOf: (ticket: {
      location: { cashPointId?: Types.ObjectId | null };
    }) => Pick<TicketEventInput, "type" | "patch" | "cashPointId">,
  ): Promise<number> {
    const refs = ticketRefsOf(input.tickets);
    return this.transactions.withTransaction(async (session) => {
      const found = await this.tickets.findMany(
        operator,
        { _id: { $in: refs.map((item) => item.id) }, orgId: store.orgId },
        { session },
      );
      const byId = new Map(found.map((ticket) => [String(ticket._id), ticket]));
      const wrong = refs
        .map((item) => byId.get(String(item.id)))
        .filter(
          (ticket) =>
            ticket?.status !== TICKET_STATUS.unsold ||
            ticket.location.kind !== TICKET_LOCATION_KIND.counter ||
            ticket.lockedBy !== null,
        );
      if (wrong.length > 0) {
        throw notOnCounterError(
          refs
            .filter((item) => {
              const ticket = byId.get(String(item.id));
              return ticket === undefined || wrong.includes(ticket);
            })
            .map((item) => String(item.id)),
        );
      }
      const at = this.clock.now();
      const events: TicketEventInput[] = refs.flatMap((item) => {
        const ticket = byId.get(String(item.id));
        return ticket === undefined
          ? []
          : [
              {
                ticketId: ticket._id,
                expectedVersion: item.version,
                expectedStatuses: [TICKET_STATUS.unsold],
                at,
                ...eventOf(ticket),
              },
            ];
      });
      await this.ledger.applyTicketEvents(session, { operator }, events);
      await this.support.publish(store);
      return events.length;
    });
  }
}
