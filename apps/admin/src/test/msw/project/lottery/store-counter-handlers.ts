import { HttpResponse } from "msw";

import {
  counterScanDecisionOf,
  formatTicketNo,
  normalizeBookNo,
  parseTicketInput,
  pendingSkipCountOf,
} from "@repo/domain/project/lottery";
import type {
  LotteryStoreBookCardQueryVariables,
  LotteryStoreCardTicketFieldsFragment,
  LotteryStoreCounterScanQueryVariables,
  MoveLotteryTicketsByCountMutationVariables,
  MoveLotteryTicketsMutationVariables,
  RecallLotteryTicketsMutationVariables,
  SplitLotteryBookMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api } from "../../server";
import type { StoreBoard } from "./store-fixtures";
import type { SalesBook } from "./store-sales-fixtures";

const ref = (id: string, name: string) => ({
  __typename: "LotteryAccountsRef" as const,
  id,
  name,
});

export interface StoreCounterContext {
  books: SalesBook[];
  board: StoreBoard;
  inputs: {
    split: SplitLotteryBookMutationVariables["input"][];
    move: MoveLotteryTicketsMutationVariables["input"][];
    recall: RecallLotteryTicketsMutationVariables["input"][];
    moveByCount: MoveLotteryTicketsByCountMutationVariables["input"][];
  };
}

/**
 * 展開卡片、拆本、移櫃 / 收回的假 api(`storeSalesWorld` 的一部分;張的狀態與銷售共用 `books`)。
 */
export const storeCounterHandlers = ({
  books,
  board,
  inputs,
}: StoreCounterContext) => {
  const pointName = (id: string | null) =>
    board.cashPoints.find((point) => point.id === id)?.name ?? "";
  const find = (ticketId: string) => {
    for (const book of books) {
      const ticket = book.tickets.find((item) => item.id === ticketId);
      if (ticket) {
        return { book, ticket };
      }
    }
    return null;
  };
  /** 來源台這個遊戲有沒有未售的張(對號的配對張;不含刷到的那張)。 */
  const hasPartner = (gameCode: string, pointId: string, ticketId: string) =>
    books.some(
      (book) =>
        book.gameCode === gameCode &&
        book.tickets.some(
          (ticket) =>
            ticket.id !== ticketId &&
            ticket.status === "unsold" &&
            ticket.cashPointId === pointId,
        ),
    );
  return [
    // [收回] / [刷條碼移櫃] 刷到一張(張數店規格 13.1;判斷用 domain 的 `counterScanDecisionOf`)
    api.query("LotteryStoreCounterScan", ({ variables }) => {
      const { input } = variables as LotteryStoreCounterScanQueryVariables;
      const parsed = parseTicketInput(input.code);
      const bookNo = parsed === null ? null : normalizeBookNo(parsed.bookNo);
      const book = books.find((item) => item.bookNo === bookNo);
      const ticket = book?.tickets.find(
        (item) => item.ticketNo === parsed?.ticketNo,
      );
      if (book === undefined || ticket === undefined) {
        return HttpResponse.json({
          data: { lotteryStoreCounterScan: { items: [] } },
        });
      }
      const decision = counterScanDecisionOf(
        {
          inThisStore: true,
          status: ticket.status as "unsold",
          unmatched: ticket.unmatched === true,
          locked: false,
          locationKind: ticket.cashPointId === null ? "stock" : "counter",
          cashPointId: ticket.cashPointId,
        },
        {
          countMode: board.countMode as "count",
          sourceCashPointId: input.fromCashPointId,
          targetCashPointId: input.toCashPointId ?? null,
        },
        hasPartner(book.gameCode, input.fromCashPointId, ticket.id),
      );
      return HttpResponse.json({
        data: {
          lotteryStoreCounterScan: {
            items: [
              {
                __typename: "LotteryStoreCounterScanItem",
                ticketId: ticket.id,
                version: ticket.version,
                bookId: book.bookId,
                gameId: `game-${book.gameCode}`,
                gameCode: book.gameCode,
                gameName: book.gameName,
                bookNo: book.bookNo,
                ticketNo: ticket.ticketNo,
                status: ticket.status,
                unmatched: ticket.unmatched === true,
                cashPoint:
                  ticket.cashPointId === null
                    ? null
                    : ref(ticket.cashPointId, pointName(ticket.cashPointId)),
                soldAt: ticket.soldAt,
                problem: decision.problem,
                match: decision.match,
              },
            ],
          },
        },
      });
    }),
    // 依張數移櫃(張數店規格 7.7):來源台這個遊戲的前 N 張未售移到目的台
    api.mutation("MoveLotteryTicketsByCount", ({ variables }) => {
      const { input } = variables as MoveLotteryTicketsByCountMutationVariables;
      inputs.moveByCount.push(input);
      const picked = books
        .filter((book) => `game-${book.gameCode}` === input.gameId)
        .flatMap((book) => book.tickets)
        .filter(
          (ticket) =>
            ticket.status === "unsold" &&
            ticket.cashPointId === input.fromCashPointId,
        )
        .slice(0, input.count);
      for (const ticket of picked) {
        ticket.cashPointId = input.toCashPointId;
        ticket.version += 1;
      }
      return HttpResponse.json({
        data: { moveLotteryTicketsByCount: { count: picked.length } },
      });
    }),
    api.query("LotteryStoreBookCard", ({ variables }) => {
      const { bookId } = variables as LotteryStoreBookCardQueryVariables;
      const book = books.find((item) => item.bookId === bookId);
      if (book === undefined) {
        return graphqlError("NOT_FOUND");
      }
      const tickets: LotteryStoreCardTicketFieldsFragment[] = book.tickets
        .filter((ticket) => ticket.status !== "skipped")
        .map((ticket) => ({
          __typename: "LotteryStoreCardTicket",
          id: ticket.id,
          ticketNo: ticket.ticketNo,
          version: ticket.version,
          status: ticket.status,
          locationKind: ticket.cashPointId === null ? "stock" : "counter",
          cashPoint:
            ticket.cashPointId === null
              ? null
              : ref(ticket.cashPointId, pointName(ticket.cashPointId)),
          soldShiftId: ticket.soldShiftId,
          soldSource:
            ticket.status === "sold" ? (ticket.soldSource ?? "scan") : null,
          locked: false,
          unmatched: ticket.unmatched === true,
        }));
      const unopened = book.tickets.every(
        (ticket) => ticket.cashPointId === null && ticket.status === "unsold",
      );
      return HttpResponse.json({
        data: {
          lotteryStoreBookCard: {
            item: {
              __typename: "LotteryStoreBookCard",
              bookId: book.bookId,
              gameCode: book.gameCode,
              gameName: book.gameName,
              unitPrice: book.unitPrice,
              bookNo: book.bookNo,
              firstTicketNo: "001",
              lastTicketNo: formatTicketNo(book.lastTicketNo),
              pendingSkipCount: unopened
                ? pendingSkipCountOf(book.lastTicketNo, book.standardTickets, 0)
                : 0,
              pendingSkipTotal: pendingSkipCountOf(
                book.lastTicketNo,
                book.standardTickets,
                book.tickets.filter((ticket) => ticket.status === "skipped")
                  .length,
              ),
              unopened,
              unmatchedCount: tickets.filter((ticket) => ticket.unmatched)
                .length,
              tickets,
            },
          },
        },
      });
    }),
    api.query("LotteryStoreStockBooks", () =>
      HttpResponse.json({
        data: {
          lotteryStoreStockBooks: {
            // 庫存裡有未售的本;整本都在庫存、都未售 = 原封不動(拆本時標跳號)
            items: books
              .filter((book) =>
                book.tickets.some(
                  (ticket) =>
                    ticket.cashPointId === null && ticket.status === "unsold",
                ),
              )
              .map((book) => {
                const sealed = book.tickets.every(
                  (ticket) =>
                    ticket.cashPointId === null && ticket.status === "unsold",
                );
                const pending = pendingSkipCountOf(
                  book.lastTicketNo,
                  book.standardTickets,
                  0,
                );
                const inStock = book.tickets.filter(
                  (ticket) =>
                    ticket.cashPointId === null && ticket.status === "unsold",
                ).length;
                return {
                  __typename: "LotteryStoreStockBook" as const,
                  bookId: book.bookId,
                  gameCode: book.gameCode,
                  gameName: book.gameName,
                  unitPrice: book.unitPrice,
                  bookNo: book.bookNo,
                  firstTicketNo: "001",
                  lastTicketNo: formatTicketNo(book.lastTicketNo),
                  ticketCount: sealed ? book.tickets.length : inStock,
                  pendingSkipCount: sealed ? pending : 0,
                  sealed,
                  pendingSkipTotal: pending,
                };
              }),
          },
        },
      }),
    ),
    api.mutation("SplitLotteryBook", ({ variables }) => {
      const { input } = variables as SplitLotteryBookMutationVariables;
      inputs.split.push(input);
      const book = books.find((item) => item.bookId === input.bookId);
      if (book === undefined) {
        return graphqlError("NOT_FOUND");
      }
      for (const ticket of book.tickets) {
        if (input.skippedTicketNos.includes(ticket.ticketNo)) {
          ticket.status = "skipped";
        }
      }
      for (const assignment of input.assignments) {
        const point = board.cashPoints.find(
          (item) => item.id === assignment.cashPointId,
        );
        for (const ticket of book.tickets) {
          if (assignment.ticketNos.includes(ticket.ticketNo)) {
            ticket.cashPointId = assignment.cashPointId;
            ticket.version += 1;
          }
        }
        point?.books.push({
          __typename: "LotteryStoreBoardBook",
          bookId: book.bookId,
          gameId: `game-${book.gameCode}`,
          gameCode: book.gameCode,
          gameName: book.gameName,
          color: book.color,
          unitPrice: book.unitPrice,
          bookNo: book.bookNo,
          remaining: assignment.ticketNos.length,
          total: assignment.ticketNos.length,
          soldToday: 0,
          isLowStock: false,
        });
      }
      return HttpResponse.json({
        data: {
          splitLotteryBook: {
            count:
              input.skippedTicketNos.length +
              input.assignments.reduce(
                (sum, item) => sum + item.ticketNos.length,
                0,
              ),
          },
        },
      });
    }),
    api.mutation("MoveLotteryTickets", ({ variables }) => {
      const { input } = variables as MoveLotteryTicketsMutationVariables;
      inputs.move.push(input);
      for (const item of input.tickets) {
        const found = find(item.ticketId);
        if (found) {
          found.ticket.cashPointId = input.toCashPointId;
          found.ticket.version += 1;
        }
      }
      return HttpResponse.json({
        data: { moveLotteryTickets: { count: input.tickets.length } },
      });
    }),
    api.mutation("RecallLotteryTickets", ({ variables }) => {
      const { input } = variables as RecallLotteryTicketsMutationVariables;
      inputs.recall.push(input);
      for (const item of input.tickets) {
        const found = find(item.ticketId);
        if (found) {
          found.ticket.cashPointId = null;
          found.ticket.version += 1;
        }
      }
      return HttpResponse.json({
        data: { recallLotteryTickets: { count: input.tickets.length } },
      });
    }),
  ];
};
