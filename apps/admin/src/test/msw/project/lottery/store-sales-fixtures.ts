import { formatTicketNo } from "@repo/domain/project/lottery";

import type { StoreBoard } from "./store-fixtures";

/** 看板上開著的一班。 */
export type BoardShift = NonNullable<StoreBoard["cashPoints"][number]["shift"]>;

/** 假 api 裡的一本:遊戲、本號、張(張號 → 狀態 / 位置 / 本班售出)。 */
export interface SalesBook {
  bookId: string;
  gameCode: string;
  gameName: string;
  unitPrice: number;
  color: string | null;
  bookNo: string;
  lastTicketNo: number;
  standardTickets: number;
  tickets: SalesTicket[];
}

export interface SalesTicket {
  id: string;
  ticketNo: string;
  version: number;
  status: string;
  cashPointId: string | null;
  soldShiftId: string | null;
  soldAt: string | null;
}

/**
 * 看板上的本 → 假 api 的張:前面 (總數 − 剩餘) 張已售(最後「今日售出」張算本班售出),其餘在那個收銀點檯面。
 * 5164 發大財 056527 另有 #041–070 在店外攤位(展開卡片的「在別的收銀點」);外加兩本還沒拆的本
 * (5201 金好運 060116 迄號 102、待標註 2;5198 鼠來寶 088104),以及和 060112 同本號的 5170 大吉利(選遊戲)。
 */
export const booksOf = (board: StoreBoard): SalesBook[] => {
  const books: SalesBook[] = board.cashPoints.flatMap((point) =>
    point.books.map((book) => {
      const sold = book.total - book.remaining;
      return {
        bookId: book.bookId,
        gameCode: book.gameCode,
        gameName: book.gameName,
        unitPrice: book.unitPrice,
        color: book.color ?? null,
        bookNo: book.bookNo,
        lastTicketNo: book.total,
        standardTickets: book.total,
        tickets: Array.from({ length: book.total }, (_, index) => {
          const isSold = index < sold;
          const thisShift = isSold && index >= sold - book.soldToday;
          return {
            id: `${book.bookId}-t${String(index + 1)}`,
            ticketNo: formatTicketNo(index + 1),
            version: 3,
            status: isSold ? "sold" : "unsold",
            cashPointId: point.id,
            soldShiftId: thisShift ? (point.shift?.id ?? null) : null,
            soldAt: isSold ? "2026-10-16T05:30:00.000Z" : null,
          };
        }),
      };
    }),
  );
  const first = books.find((book) => book.bookNo === "0056527");
  for (const ticket of first?.tickets ?? []) {
    const no = Number(ticket.ticketNo);
    if (no >= 41 && no <= 70 && ticket.status === "unsold") {
      ticket.cashPointId = "cp-outdoor";
    }
  }
  const unopened = (
    bookId: string,
    gameCode: string,
    gameName: string,
    unitPrice: number,
    bookNo: string,
    lastTicketNo: number,
  ): SalesBook => ({
    bookId,
    gameCode,
    gameName,
    unitPrice,
    color: null,
    bookNo,
    lastTicketNo,
    standardTickets: 100,
    tickets: Array.from({ length: lastTicketNo }, (_, index) => ({
      id: `${bookId}-t${String(index + 1)}`,
      ticketNo: formatTicketNo(index + 1),
      version: 1,
      status: "unsold",
      cashPointId: null,
      soldShiftId: null,
      soldAt: null,
    })),
  });
  books.push(
    unopened("b-new-1", "5201", "金好運", 100, "0060116", 102),
    unopened("b-new-2", "5198", "鼠來寶", 100, "0088104", 100),
    {
      ...unopened("b-same-no", "5170", "大吉利", 100, "0060112", 100),
      tickets: unopened(
        "b-same-no",
        "5170",
        "大吉利",
        100,
        "0056527",
        100,
      ).tickets.map((ticket) => ({ ...ticket, cashPointId: "cp-counter" })),
    },
  );
  return books;
};
