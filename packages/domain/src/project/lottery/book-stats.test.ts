import { describe, expect, it } from "@jest/globals";

import {
  type BookTicketCounts,
  type BookTicketSnapshot,
  allocationGivenOf,
  bookCountKeyOf,
  bookCountsOf,
  bookDisplayStateOf,
  emptyBookCounts,
  holdingsOf,
  holdingsWithoutPendingSkips,
  isUnopenedInStore,
  pendingPlacementOf,
  pendingSkipCountOf,
  remainingOfCounts,
  totalOfCounts,
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

  it("剩餘只算未售;所在分店只算未售的張", () => {
    const book = [
      ...tickets(60),
      ...tickets(30, { storeOrgId: "b" }),
      ...tickets(5, { status: "sold" }),
      ...tickets(3, { status: "skipped" }),
    ];
    expect(remainingOfCounts(bookCountsOf(book), 0)).toBe(90);
    // 迄號 103、標準 100、還沒標跳號:未售 103 − 待標註 3 = 100
    expect(
      remainingOfCounts(
        bookCountsOf(tickets(103)),
        pendingSkipCountOf(103, 100, 0),
      ),
    ).toBe(100);
    expect(Object.fromEntries(holdingsOf(book))).toEqual({ a: 60, b: 30 });
  });
});

const counts = (partial: Partial<BookTicketCounts>): BookTicketCounts => ({
  ...emptyBookCounts(),
  ...partial,
});

describe("本上的張數與顯示狀態(使用者 10/27 定案 B)", () => {
  it("一張算在哪一格:未售分庫存 / 檯面 / 在途;跳號不算", () => {
    expect(bookCountKeyOf("unsold", "stock")).toBe("stock");
    expect(bookCountKeyOf("unsold", "counter")).toBe("counter");
    expect(bookCountKeyOf("unsold", "in_transit")).toBe("inTransit");
    expect(bookCountKeyOf("investigating", "stock")).toBe("investigating");
    expect(bookCountKeyOf("skipped", "stock")).toBeNull();
    expect(
      bookCountsOf([
        ...tickets(98),
        ...tickets(2, { status: "skipped" }),
        ...tickets(5, { status: "sold", locationKind: "counter" }),
      ]),
    ).toEqual(counts({ stock: 98, sold: 5 }));
  });

  it("待標註只扣一次:有待查 / 遺失扣那一組,沒有才扣未售", () => {
    // 整本待查後尋回 3 張:剩餘 3(待標註在待查那一組)
    expect(pendingPlacementOf(counts({ stock: 3, investigating: 98 }), 1)).toBe(
      "missing",
    );
    expect(remainingOfCounts(counts({ stock: 3, investigating: 98 }), 1)).toBe(
      3,
    );
    expect(pendingPlacementOf(counts({ stock: 101 }), 1)).toBe("unsold");
    expect(pendingPlacementOf(counts({ stock: 101 }), 0)).toBeNull();
    // 分在兩家店:只扣張數多的那家
    expect(
      Object.fromEntries(
        holdingsWithoutPendingSkips(
          new Map([
            ["a", 50],
            ["b", 51],
          ]),
          counts({ stock: 101 }),
          1,
        ),
      ),
    ).toEqual({ a: 50, b: 50 });
    expect(
      Object.fromEntries(
        holdingsWithoutPendingSkips(
          new Map([["a", 3]]),
          counts({ stock: 3, investigating: 98 }),
          1,
        ),
      ),
    ).toEqual({ a: 3 });
  });

  it("剩餘 / 總張數:還有待標註就扣(不看拆過沒有)", () => {
    expect(remainingOfCounts(counts({ stock: 103 }), 3)).toBe(100);
    expect(totalOfCounts(counts({ stock: 103 }), 3)).toBe(100);
    // 整本待查後尋回 3 張:還沒標的跳號在待查那一組,總張數照扣
    expect(totalOfCounts(counts({ stock: 3, investigating: 98 }), 1)).toBe(100);
    expect(totalOfCounts(counts({ stock: 90, sold: 10 }), 0)).toBe(100);
  });

  it("九種顯示狀態依序判斷(實測表 C01–C16)", () => {
    const state = (
      partial: Partial<BookTicketCounts>,
      firstOpenedAt: Date | null = null,
      revoked = false,
    ) =>
      bookDisplayStateOf({ counts: counts(partial), firstOpenedAt, revoked });
    const opened = new Date("2026-11-01T00:00:00Z");
    expect(state({ stock: 100 }, null, true)).toBe("revoked");
    expect(state({ stock: 100 })).toBe("unopened");
    expect(state({ counter: 70, stock: 30 }, opened)).toBe("on_counter");
    // 拆過又全部收回:拆過就不算未拆
    expect(state({ stock: 100 }, opened)).toBe("in_stock");
    // 整本待查後尋回 3 張(從沒拆過,但有張不在庫存)
    expect(state({ stock: 3, investigating: 97 })).toBe("in_stock");
    expect(state({ inTransit: 100 })).toBe("in_transit");
    expect(state({ inTransit: 20, sold: 80 }, opened)).toBe("in_transit");
    expect(state({ sold: 10, investigating: 90 }, opened)).toBe(
      "investigating",
    );
    expect(state({ sold: 10, lost: 90 }, opened)).toBe("lost");
    expect(state({ scrapped: 100 })).toBe("scrapped");
    expect(state({ sold: 10, scrapped: 90 }, opened)).toBe("sold_out");
    expect(state({ sold: 100 }, opened)).toBe("sold_out");
  });

  it("一家店的未拆:從沒拆過、這家店的張全是未售在庫存", () => {
    expect(isUnopenedInStore(null, tickets(100))).toBe(true);
    expect(isUnopenedInStore(new Date(), tickets(100))).toBe(false);
    expect(
      isUnopenedInStore(null, [
        ...tickets(3),
        ...tickets(97, { status: "investigating" }),
      ]),
    ).toBe(false);
    expect(isUnopenedInStore(null, [])).toBe(false);
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
