import { HttpResponse } from "msw";

import {
  formatTicketNo,
  pendingSkipCountOf,
} from "@repo/domain/project/lottery";
import type {
  LotteryStoreBookCardQueryVariables,
  LotteryStoreCardTicketFieldsFragment,
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
  return [
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
          locked: false,
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
              unopened,
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
            items: books
              .filter((book) =>
                book.tickets.every(
                  (ticket) =>
                    ticket.cashPointId === null && ticket.status === "unsold",
                ),
              )
              .map((book) => ({
                __typename: "LotteryStoreStockBook" as const,
                bookId: book.bookId,
                gameCode: book.gameCode,
                gameName: book.gameName,
                unitPrice: book.unitPrice,
                bookNo: book.bookNo,
                firstTicketNo: "001",
                lastTicketNo: formatTicketNo(book.lastTicketNo),
                ticketCount: book.tickets.length,
                pendingSkipCount: pendingSkipCountOf(
                  book.lastTicketNo,
                  book.standardTickets,
                  0,
                ),
                sealed: true,
              })),
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
