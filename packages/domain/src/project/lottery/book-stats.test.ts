import { describe, expect, it } from "@jest/globals";

import {
  type BookTicketSnapshot,
  allocationGivenOf,
  bookStateOf,
  holdingsOf,
  pendingSkipCountOf,
  remainingCountOf,
} from "./book-stats";

function tickets(
  count: number,
  overrides: Partial<BookTicketSnapshot> = {},
): BookTicketSnapshot[] {
  return Array.from({ length: count }, () => ({
    status: "unsold",
    locationKind: "stock",
    storeOrgId: "a",
    ...overrides,
  }));
}

describe("本的即時計算(規格 7.1)", () => {
  it("待標註 = 迄號 − 標準張數 − 已標跳號", () => {
    expect(pendingSkipCountOf(103, 100, 0)).toBe(3);
    expect(pendingSkipCountOf(103, 100, 2)).toBe(1);
    expect(pendingSkipCountOf(100, 100, 0)).toBe(0);
  });

  it("剩餘只算未售;持有不算跳號", () => {
    const book = [
      ...tickets(60),
      ...tickets(30, { storeOrgId: "b" }),
      ...tickets(5, { status: "sold" }),
      ...tickets(3, { status: "skipped" }),
    ];
    expect(remainingCountOf(book)).toBe(90);
    // 迄號 103、標準 100、還沒標跳號:未售 103 − 待標註 3 = 100
    expect(
      remainingCountOf(tickets(103), pendingSkipCountOf(103, 100, 0)),
    ).toBe(100);
    expect(Object.fromEntries(holdingsOf(book))).toEqual({ a: 65, b: 30 });
  });

  it("未拆 / 檯面中 / 售完", () => {
    expect(
      bookStateOf([...tickets(100), ...tickets(3, { status: "skipped" })]),
    ).toBe("unopened");
    expect(
      bookStateOf([...tickets(99), ...tickets(1, { locationKind: "counter" })]),
    ).toBe("on_counter");
    expect(
      bookStateOf([...tickets(99), ...tickets(1, { status: "sold" })]),
    ).toBe("on_counter");
    expect(bookStateOf([...tickets(100, { status: "sold" })])).toBe("sold_out");
  });
});

describe("已給本數(規格 7.6)", () => {
  it("進 2 本、調出 30 張 → 1 本 +70 張", () => {
    expect(
      allocationGivenOf([
        { netTickets: 100, usableTickets: 100 },
        { netTickets: 70, usableTickets: 100 },
      ]),
    ).toEqual({ books: 1, extraTickets: 70 });
  });

  it("零碎張數不湊成一本;淨張數 ≤ 0 不算;未標跳號的本(多出待標註)仍算 1 本", () => {
    expect(
      allocationGivenOf([
        { netTickets: 60, usableTickets: 100 },
        { netTickets: 60, usableTickets: 100 },
        { netTickets: 0, usableTickets: 100 },
        { netTickets: 103, usableTickets: 100 },
      ]),
    ).toEqual({ books: 1, extraTickets: 120 });
  });
});
