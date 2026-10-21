import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  pendingSkipCountOf,
  splitPlanProblemOf,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type {
  MoveLotteryTicketsInput,
  RecallLotteryTicketsInput,
  SplitLotteryBookInput,
} from "./dto/lottery-store-sales.input";
import type { LotteryStoreUnopenedBookModel } from "./models/lottery-store-sales.model";
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
 * - **拆本**(`store.split`):本店還沒拆的本 → ① 標跳號(剛好待標註張數)② 每一張放到一個收銀點;
 *   寫「跳號」與「拆本」事件。拆本時分放到多個收銀點算拆本,不需要 `store.move`
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

  /** 拆本「先選要拆的本」:本店還沒拆的本(未售的張全在庫存),依遊戲代號、本號排序。 */
  async unopenedBooks(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreUnopenedBookModel[]> {
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
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    const unopened = rows.filter(
      (row) =>
        Number(row.total) > 0 && Number(row.total) === Number(row.inStock),
    );
    if (unopened.length === 0) {
      return [];
    }
    const countOf = new Map(
      unopened.map((row) => [String(row._id), Number(row.inStock)]),
    );
    const books = await this.books.findMany(operator, {
      _id: { $in: unopened.map((row) => row._id as Types.ObjectId) },
      status: "normal",
    });
    const games = await this.support.gamesOf(
      operator,
      books.map((book) => book.gameId),
    );
    return books
      .map((book) => {
        const game = games.get(String(book.gameId));
        return {
          bookId: String(book._id),
          gameCode: book.gameCode,
          gameName: game?.name ?? "",
          unitPrice: game?.unitPrice ?? 0,
          bookNo: book.bookNo,
          firstTicketNo: book.firstTicketNo,
          lastTicketNo: book.lastTicketNo,
          ticketCount: countOf.get(String(book._id)) ?? 0,
          pendingSkipCount: pendingSkipCountOf(
            Number(book.lastTicketNo),
            book.standardTickets,
            book.skippedTicketNos.length,
          ),
        };
      })
      .toSorted(
        (a, b) =>
          a.gameCode.localeCompare(b.gameCode) ||
          a.bookNo.localeCompare(b.bookNo),
      );
  }

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
      const tickets = await this.tickets.findMany(
        operator,
        { bookId: book._id, orgId: store.orgId },
        { session },
      );
      const usable = tickets.filter(
        (ticket) => ticket.status !== TICKET_STATUS.skipped,
      );
      const unopened =
        usable.length > 0 &&
        usable.every(
          (ticket) =>
            ticket.status === TICKET_STATUS.unsold &&
            ticket.location.kind === TICKET_LOCATION_KIND.stock,
        );
      if (!unopened) {
        throw bookAlreadyOpenedError();
      }
      const pending = pendingSkipCountOf(
        Number(book.lastTicketNo),
        book.standardTickets,
        book.skippedTicketNos.length,
      );
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
