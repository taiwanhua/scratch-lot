import { HttpResponse } from "msw";

import {
  displayTicketKey,
  parseTicketInput,
  pendingSkipCountOf,
  storeScanDecisionOf,
} from "@repo/domain/project/lottery";
import type {
  LotteryStoreRecentSalesQueryVariables,
  LotteryStoreSaleFieldsFragment,
  LotteryStoreSaleQueryVariables,
  LotteryStoreScanItemFieldsFragment,
  LotteryStoreScanQueryVariables,
  MoveLotteryTicketsMutationVariables,
  RecallLotteryTicketsMutationVariables,
  SellLotteryTicketsMutationVariables,
  SplitLotteryBookMutationVariables,
  UndoLotteryTicketSaleMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import { storeCounterHandlers } from "./store-counter-handlers";
import type { StoreBoard } from "./store-fixtures";
import {
  type BoardShift,
  type SalesBook,
  type SalesTicket,
  booksOf,
} from "./store-sales-fixtures";

interface SaleRecord {
  ticketId: string;
  bookId: string;
  shiftId: string;
  cashPointId: string;
  amount: number;
  soldAt: string;
  undone: boolean;
}

export interface StoreSalesWorld {
  handlers: Parameters<typeof server.use>;
  inputs: {
    sell: SellLotteryTicketsMutationVariables["input"][];
    undo: UndoLotteryTicketSaleMutationVariables["input"][];
    split: SplitLotteryBookMutationVariables["input"][];
    move: MoveLotteryTicketsMutationVariables["input"][];
    recall: RecallLotteryTicketsMutationVariables["input"][];
  };
}

export interface StoreSalesWorldOptions {
  /** 看板的狀態(`storeWorld(...).state`;售出 / 撤銷時跟著改) */
  board: StoreBoard;
  /** 下一次售出直接回「已於 hh:mm 售出」(同時兩人賣同一張的失敗方) */
  alreadySoldAt?: string;
  /** 這幾張是遺失(展開卡片選它 → [尋回]) */
  lostTicketIds?: readonly string[];
}

const validation = (reason: string, extra: Record<string, unknown> = {}) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, ...extra });

const ref = (id: string, name: string) => ({
  __typename: "LotteryAccountsRef" as const,
  id,
  name,
});

/**
 * 店面銷售的假 api(規則照 `docs/modules/project/store.md`「銷售與拆本」):刷到時(`storeScanDecisionOf`)、
 * 售出 / 當下撤銷(看板的本班已售、應有現金、剩餘跟著變)、展開卡片、拆本、移櫃 / 收回。元件測試與 mock 模式共用。
 */
export const storeSalesWorld = ({
  board,
  alreadySoldAt,
  lostTicketIds = [],
}: StoreSalesWorldOptions): StoreSalesWorld => {
  const books = booksOf(board);
  for (const ticket of books.flatMap((book) => book.tickets)) {
    if (lostTicketIds.includes(ticket.id)) {
      ticket.status = "lost";
    }
  }
  const sales: SaleRecord[] = [];
  const inputs: StoreSalesWorld["inputs"] = {
    sell: [],
    undo: [],
    split: [],
    move: [],
    recall: [],
  };
  let pendingAlreadySold = alreadySoldAt;
  const pointName = (id: string | null) =>
    board.cashPoints.find((point) => point.id === id)?.name ?? "";
  const shiftOf = (cashPointId: string | null) =>
    board.cashPoints.find((point) => point.id === cashPointId)?.shift ?? null;
  const find = (ticketId: string) => {
    for (const book of books) {
      const ticket = book.tickets.find((item) => item.id === ticketId);
      if (ticket) {
        return { book, ticket };
      }
    }
    return null;
  };
  const boardBookOf = (bookId: string, cashPointId: string | null) =>
    board.cashPoints
      .find((point) => point.id === cashPointId)
      ?.books.find((book) => book.bookId === bookId);
  const saleModel = (record: SaleRecord): LotteryStoreSaleFieldsFragment => {
    const found = find(record.ticketId);
    return {
      __typename: "LotteryStoreSale",
      ticketId: record.ticketId,
      version: found?.ticket.version ?? 0,
      ticketKey: found
        ? displayTicketKey(
            found.book.gameCode,
            found.book.bookNo,
            found.ticket.ticketNo,
          )
        : "",
      amount: record.amount,
      soldAt: record.soldAt,
      cashPoint: ref(record.cashPointId, pointName(record.cashPointId)),
      shiftId: record.shiftId,
      undone: record.undone,
      undoBlock: record.undone ? "already_undone" : null,
    };
  };
  /** 售出 / 撤銷時跟著改看板(本班已售、應有現金、卡片剩餘)。 */
  const applyToBoard = (
    bookId: string,
    shiftCashPointId: string,
    tickets: SalesTicket[],
    amount: number,
    sign: 1 | -1,
  ) => {
    const shift = shiftOf(shiftCashPointId);
    if (shift) {
      shift.soldCount += sign;
      shift.soldAmount += sign * amount;
      shift.expectedCash += sign * amount;
    }
    for (const ticket of tickets) {
      const card = boardBookOf(bookId, ticket.cashPointId);
      if (card) {
        card.remaining -= sign;
      }
    }
  };
  const scanItem = (
    book: SalesBook,
    ticket: SalesTicket,
    localId: string | null,
  ): LotteryStoreScanItemFieldsFragment => {
    const unopened = book.tickets.every(
      (item) => item.cashPointId === null && item.status === "unsold",
    );
    const counterShift = shiftOf(ticket.cashPointId);
    const decision = storeScanDecisionOf(
      {
        status: ticket.status as "unsold",
        locationKind: ticket.cashPointId === null ? "stock" : "counter",
        cashPointId: ticket.cashPointId,
        inThisStore: true,
        locked: false,
        bookUnopened: unopened,
        counterShiftIsMine: counterShift?.isMine === true,
      },
      {
        localCashPointId: localId,
        localShiftOpen: shiftOf(localId) !== null,
        canSell: true,
        canMove: true,
      },
    );
    return {
      __typename: "LotteryStoreScanItem",
      ticketId: ticket.id,
      version: ticket.version,
      bookId: book.bookId,
      gameCode: book.gameCode,
      gameName: book.gameName,
      unitPrice: book.unitPrice,
      bookNo: book.bookNo,
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      locationKind: ticket.cashPointId === null ? "stock" : "counter",
      cashPoint:
        ticket.cashPointId === null
          ? null
          : ref(ticket.cashPointId, pointName(ticket.cashPointId)),
      counterShiftOwner: counterShift ? counterShift.openedBy : null,
      responsibleOrg: null,
      outcome: decision.outcome,
      blockReason: decision.blockReason,
      soldAt: ticket.soldAt,
      pendingSkipCount: unopened
        ? pendingSkipCountOf(book.lastTicketNo, book.standardTickets, 0)
        : 0,
    };
  };

  const handlers = [
    api.query("LotteryStoreScan", ({ variables }) => {
      const { input } = variables as LotteryStoreScanQueryVariables;
      const parsed = parseTicketInput(input.code);
      const items =
        parsed === null
          ? []
          : books
              .filter(
                (book) =>
                  book.bookNo === parsed.bookNo &&
                  (parsed.gameCode === undefined ||
                    book.gameCode === parsed.gameCode),
              )
              .flatMap((book) => {
                const ticket = book.tickets.find(
                  (item) => item.ticketNo === parsed.ticketNo,
                );
                return ticket
                  ? [scanItem(book, ticket, input.localCashPointId ?? null)]
                  : [];
              });
      return HttpResponse.json({
        data: { lotteryStoreScan: { items } },
      });
    }),
    api.mutation("SellLotteryTickets", ({ variables }) => {
      const { input } = variables as SellLotteryTicketsMutationVariables;
      inputs.sell.push(input);
      if (pendingAlreadySold !== undefined) {
        const soldAt = pendingAlreadySold;
        pendingAlreadySold = undefined;
        return validation("ALREADY_SOLD", { soldAt, fields: ["tickets"] });
      }
      const localShift = shiftOf(input.localCashPointId);
      if (localShift === null) {
        return validation("LOCAL_SHIFT_NOT_OPEN");
      }
      const now = new Date().toISOString();
      const rows: LotteryStoreSaleFieldsFragment[] = [];
      for (const item of input.tickets) {
        const found = find(item.ticketId);
        if (found === null) {
          return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
        }
        const { book, ticket } = found;
        if (ticket.status === "sold") {
          return validation("ALREADY_SOLD", { soldAt: ticket.soldAt });
        }
        const counterShift = shiftOf(ticket.cashPointId);
        const shift: BoardShift =
          ticket.cashPointId !== input.localCashPointId &&
          counterShift?.isMine === true
            ? counterShift
            : localShift;
        const fromPoint = ticket.cashPointId;
        if (input.confirmMove === true && shift === localShift) {
          ticket.cashPointId = input.localCashPointId;
        }
        applyToBoard(
          book.bookId,
          shift.cashPoint.id,
          [{ ...ticket, cashPointId: fromPoint }],
          book.unitPrice,
          1,
        );
        ticket.status = "sold";
        ticket.version += 1;
        ticket.soldShiftId = shift.id;
        ticket.soldAt = now;
        const record: SaleRecord = {
          ticketId: ticket.id,
          bookId: book.bookId,
          shiftId: shift.id,
          cashPointId: shift.cashPoint.id,
          amount: book.unitPrice,
          soldAt: now,
          undone: false,
        };
        sales.unshift(record);
        rows.push(saleModel(record));
      }
      return HttpResponse.json({
        data: { sellLotteryTickets: { items: rows } },
      });
    }),
    api.query("LotteryStoreSale", ({ variables }) => {
      const { ticketId } = variables as LotteryStoreSaleQueryVariables;
      const record = sales.find((sale) => sale.ticketId === ticketId);
      if (record === undefined) {
        // 不是這次在假 api 賣的(夾具裡早就賣掉的)→ 超過 30 分鐘
        const found = find(ticketId);
        if (found === null) {
          return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
        }
        return HttpResponse.json({
          data: {
            lotteryStoreSale: {
              item: {
                ...saleModel({
                  ticketId,
                  bookId: found.book.bookId,
                  shiftId: found.ticket.soldShiftId ?? "",
                  cashPointId: found.ticket.cashPointId ?? "",
                  amount: found.book.unitPrice,
                  soldAt: found.ticket.soldAt ?? new Date().toISOString(),
                  undone: false,
                }),
                undoBlock: "expired",
              },
            },
          },
        });
      }
      return HttpResponse.json({
        data: { lotteryStoreSale: { item: saleModel(record) } },
      });
    }),
    api.query("LotteryStoreRecentSales", ({ variables }) => {
      const { shiftId } = variables as LotteryStoreRecentSalesQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryStoreRecentSales: {
            items: sales
              .filter((sale) => sale.shiftId === shiftId)
              .map((sale) => saleModel(sale)),
          },
        },
      });
    }),
    api.mutation("UndoLotteryTicketSale", ({ variables }) => {
      const { input } = variables as UndoLotteryTicketSaleMutationVariables;
      inputs.undo.push(input);
      const record = sales.find(
        (sale) => sale.ticketId === input.ticketId && !sale.undone,
      );
      const found = find(input.ticketId);
      if (record === undefined || found === null) {
        return validation("UNDO_NOT_ALLOWED", { undoBlock: "expired" });
      }
      record.undone = true;
      found.ticket.status = "unsold";
      found.ticket.version += 1;
      found.ticket.soldShiftId = null;
      found.ticket.soldAt = null;
      applyToBoard(
        found.book.bookId,
        record.cashPointId,
        [found.ticket],
        record.amount,
        -1,
      );
      return HttpResponse.json({
        data: { undoLotteryTicketSale: { item: saleModel(record) } },
      });
    }),
    ...storeCounterHandlers({ books, board, inputs }),
  ];
  return { handlers, inputs };
};
