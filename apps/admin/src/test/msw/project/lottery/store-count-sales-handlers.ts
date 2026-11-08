import { HttpResponse } from "msw";

import type {
  LotteryStoreSaleFieldsFragment,
  SellLotteryTicketsByCountMutationVariables,
  UndoLotteryCountSaleMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api } from "../../server";
import type { StoreBoard } from "./store-fixtures";
import type {
  BoardShift,
  SaleRecord,
  SalesBook,
  SalesTicket,
} from "./store-sales-fixtures";
import type { StoreSalesWorld } from "./store-sales-handlers";

const validation = (reason: string, extra: Record<string, unknown> = {}) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, ...extra });

/** 銷售假 api 的共用狀態與工具(`storeSalesWorld` 給)。 */
export interface StoreCountSalesContext {
  board: StoreBoard;
  books: SalesBook[];
  sales: SaleRecord[];
  inputs: StoreSalesWorld["inputs"];
  shiftOf: (cashPointId: string | null) => BoardShift | null;
  find: (ticketId: string) => { book: SalesBook; ticket: SalesTicket } | null;
  applyToBoard: (
    bookId: string,
    shiftCashPointId: string,
    tickets: SalesTicket[],
    amount: number,
    sign: 1 | -1,
  ) => void;
  saleModel: (record: SaleRecord) => LotteryStoreSaleFieldsFragment;
}

/**
 * 張數店的對號(假 api 版):配對張 = 本機收銀點同遊戲、未售的第一張(依本、張號;同 api 照挑張順序取第一張);
 * 已售·未對號賣出前和它互換(規格 6.1)。`matchUnmatched` 回 true = 對號了、false = 不用對號、null = 找不到配對。
 */
export const countStoreMatching = (books: readonly SalesBook[]) => {
  const partnerOf = (gameCode: string, localId: string | null) => {
    for (const book of books.filter((item) => item.gameCode === gameCode)) {
      const ticket = book.tickets.find(
        (item) => item.status === "unsold" && item.cashPointId === localId,
      );
      if (ticket) {
        return { book, ticket };
      }
    }
    return null;
  };
  const matchUnmatched = (
    book: SalesBook,
    ticket: SalesTicket,
    localId: string,
  ): boolean | null => {
    if (ticket.status !== "sold" || ticket.unmatched !== true) {
      return false;
    }
    const partner = partnerOf(book.gameCode, localId);
    if (partner === null) {
      return null;
    }
    Object.assign(partner.ticket, {
      status: "sold",
      unmatched: true,
      soldSource: "count",
      soldAt: ticket.soldAt,
      cashPointId: ticket.cashPointId,
      version: partner.ticket.version + 1,
    });
    Object.assign(ticket, {
      status: "unsold",
      unmatched: false,
      soldSource: null,
      soldAt: null,
      cashPointId: localId,
      version: ticket.version + 1,
    });
    return true;
  };
  return { partnerOf, matchUnmatched };
};

/**
 * 張數店的依張數標記售出、撤銷幾張與 [最近售出] 合成一列的假 api(張數店規格 7.2、7.3、13.2;
 * 只有張數店能用,照本機收銀點同遊戲未售的張依本、張號挑)。
 */
export const storeCountSalesHandlers = ({
  board,
  books,
  sales,
  inputs,
  shiftOf,
  find,
  applyToBoard,
  saleModel,
}: StoreCountSalesContext) => {
  let refSequence = 0;
  const nextRefId = () => {
    refSequence += 1;
    return `count-${String(refSequence)}`;
  };
  /** 一次依張數賣出合成的一列(張數店規格 13.2)。 */
  const countRowOf = (
    first: SaleRecord,
    records: readonly SaleRecord[],
  ): LotteryStoreSaleFieldsFragment => {
    const found = find(first.ticketId);
    const undone = records.filter((record) => record.undone).length;
    const live = records.length - undone;
    return {
      ...saleModel(first),
      amount: records.reduce((sum, record) => sum + record.amount, 0),
      undone: live === 0,
      undoBlock: live === 0 ? "already_undone" : null,
      countSale: {
        __typename: "LotteryStoreCountSaleRow",
        refId: first.refId ?? "",
        gameId: `game-${found?.book.gameCode ?? ""}`,
        gameCode: found?.book.gameCode ?? "",
        gameName: found?.book.gameName ?? "",
        unitPrice: found?.book.unitPrice ?? 0,
        count: records.length,
        undoneCount: undone,
        undoableCount: live,
      },
    };
  };
  /** 最近售出:刷條碼一張一列、依張數一次一列(放在第一筆的位置)。 */
  const recentOf = (list: readonly SaleRecord[]) => {
    const rows: LotteryStoreSaleFieldsFragment[] = [];
    const seen = new Set<string>();
    for (const record of list) {
      if (record.refId === undefined) {
        rows.push(saleModel(record));
      } else if (!seen.has(record.refId)) {
        seen.add(record.refId);
        rows.push(
          countRowOf(
            record,
            list.filter((item) => item.refId === record.refId),
          ),
        );
      }
    }
    return rows;
  };

  const handlers = [
    api.mutation("SellLotteryTicketsByCount", ({ variables }) => {
      const { input } = variables as SellLotteryTicketsByCountMutationVariables;
      inputs.countSale.push(input);
      if (board.countMode !== "count") {
        return validation("COUNT_SALE_NOT_ALLOWED", {
          countMode: board.countMode,
        });
      }
      const shift = shiftOf(input.localCashPointId);
      if (shift === null) {
        return validation("LOCAL_SHIFT_NOT_OPEN");
      }
      const now = new Date().toISOString();
      const items = [];
      for (const line of input.lines) {
        const gameBooks = books.filter(
          (book) => `game-${book.gameCode}` === line.gameId,
        );
        const picked = gameBooks.flatMap((book) =>
          book.tickets
            .filter(
              (ticket) =>
                ticket.status === "unsold" &&
                ticket.cashPointId === input.localCashPointId,
            )
            .map((ticket) => ({ book, ticket })),
        );
        if (picked.length < line.count) {
          return validation("COUNT_SALE_INVALID", {
            problem: "exceeds",
            gameId: line.gameId,
            available: picked.length,
          });
        }
        const refId = nextRefId();
        for (const { book, ticket } of picked.slice(0, line.count)) {
          applyToBoard(
            book.bookId,
            shift.cashPoint.id,
            [ticket],
            book.unitPrice,
            1,
          );
          Object.assign(ticket, {
            status: "sold",
            unmatched: true,
            soldSource: "count",
            soldAt: now,
            soldShiftId: shift.id,
            version: ticket.version + 1,
          });
          sales.unshift({
            ticketId: ticket.id,
            bookId: book.bookId,
            shiftId: shift.id,
            cashPointId: shift.cashPoint.id,
            amount: book.unitPrice,
            soldAt: now,
            undone: false,
            refId,
          });
        }
        const book = gameBooks.at(0);
        items.push({
          __typename: "LotteryStoreCountSale" as const,
          refId,
          gameId: line.gameId,
          gameCode: book?.gameCode ?? "",
          gameName: book?.gameName ?? "",
          unitPrice: book?.unitPrice ?? 0,
          count: line.count,
          amount: (book?.unitPrice ?? 0) * line.count,
        });
      }
      return HttpResponse.json({
        data: { sellLotteryTicketsByCount: { items } },
      });
    }),
    api.mutation("UndoLotteryCountSale", ({ variables }) => {
      const { input } = variables as UndoLotteryCountSaleMutationVariables;
      inputs.undoCount.push(input);
      const all = sales.filter((sale) => sale.refId === input.refId);
      const live = all.filter((sale) => !sale.undone);
      const first = all.at(0);
      if (first === undefined || live.length < input.count) {
        return validation("COUNT_UNDO_EXCEEDS", { available: live.length });
      }
      for (const record of live.slice(0, input.count)) {
        const found = find(record.ticketId);
        record.undone = true;
        if (found !== null) {
          applyToBoard(
            found.book.bookId,
            record.cashPointId,
            [found.ticket],
            record.amount,
            -1,
          );
          Object.assign(found.ticket, {
            status: "unsold",
            unmatched: false,
            soldSource: null,
            soldAt: null,
            soldShiftId: null,
            version: found.ticket.version + 1,
          });
        }
      }
      return HttpResponse.json({
        data: { undoLotteryCountSale: { item: countRowOf(first, all) } },
      });
    }),
  ];
  return { handlers, recentOf };
};
