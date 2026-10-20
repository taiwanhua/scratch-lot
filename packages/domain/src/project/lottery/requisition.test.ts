import { describe, expect, it } from "@jest/globals";

import {
  type RequisitionCandidateOrder,
  allocationExcessOf,
  estimatedPurchaseAmountOf,
  isNewGame,
  recentSalesOf,
  requisitionLinesOf,
  sortRequisitionCandidates,
} from "./requisition";

const NOW = new Date("2026-10-20T04:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function candidate(
  gameCode: string,
  overrides: Partial<RequisitionCandidateOrder> = {},
): RequisitionCandidateOrder {
  return { gameCode, launchedAt: null, sold30: 0, ...overrides };
}

describe("新遊戲(規格 8.1:上市 30 天內)", () => {
  it("上市 30 天內是新遊戲,第 31 天起不是", () => {
    expect(isNewGame(daysAgo(0), NOW)).toBe(true);
    expect(isNewGame(daysAgo(30), NOW)).toBe(true);
    expect(isNewGame(daysAgo(31), NOW)).toBe(false);
  });

  it("沒填上市日不標【新】", () => {
    expect(isNewGame(null, NOW)).toBe(false);
  });

  it("上市日在未來(預告上市)也算新遊戲", () => {
    expect(isNewGame(new Date(NOW.getTime() + 3 * DAY), NOW)).toBe(true);
  });
});

describe("近 7 / 30 天賣出(新遊戲顯示「—」不是 0)", () => {
  it("新遊戲還沒賣過 → null(畫面顯示「—」)", () => {
    expect(recentSalesOf(true, 0)).toBeNull();
  });

  it("新遊戲已經有賣 → 照實際張數", () => {
    expect(recentSalesOf(true, 4)).toBe(4);
  });

  it("不是新遊戲,沒賣 → 0", () => {
    expect(recentSalesOf(false, 0)).toBe(0);
  });
});

describe("排序(規格 8.1)", () => {
  it("新遊戲排最上(上市日新到舊),其他依近 30 天賣出多到少", () => {
    const sorted = sortRequisitionCandidates(
      [
        candidate("5150", { sold30: 95 }),
        candidate("5198", { launchedAt: daysAgo(10) }),
        candidate("5164", { sold30: 180 }),
        candidate("5201", { launchedAt: daysAgo(2) }),
        candidate("5133", { sold30: 20, launchedAt: daysAgo(400) }),
      ],
      NOW,
    );
    expect(sorted.map((row) => row.gameCode)).toEqual([
      "5201",
      "5198",
      "5164",
      "5150",
      "5133",
    ]);
  });

  it("沒填上市日不算新遊戲,照銷售排;同銷量依遊戲代號", () => {
    const sorted = sortRequisitionCandidates(
      [
        candidate("5002", { sold30: 10 }),
        candidate("5001", { sold30: 10 }),
        candidate("5003", { sold30: 50 }),
      ],
      NOW,
    );
    expect(sorted.map((row) => row.gameCode)).toEqual(["5003", "5001", "5002"]);
  });

  it("不改動傳入的陣列", () => {
    const rows = [candidate("2"), candidate("1")];
    sortRequisitionCandidates(rows, NOW);
    expect(rows.map((row) => row.gameCode)).toEqual(["2", "1"]);
  });
});

describe("預估批購金額 = Σ(整本金額 × 預設批購金額率 × 本數)", () => {
  it("加總後四捨五入到元", () => {
    expect(
      estimatedPurchaseAmountOf([
        { bookPrice: 20_000, defaultRate: 92, books: 2 },
        { bookPrice: 25_000, defaultRate: 92, books: 1 },
      ]),
    ).toBe(59_800);
    expect(
      estimatedPurchaseAmountOf([
        { bookPrice: 1999, defaultRate: 91, books: 1 },
      ]),
    ).toBe(1819);
  });

  it("沒有列 → 0", () => {
    expect(estimatedPurchaseAmountOf([])).toBe(0);
  });
});

describe("超過預計要給本數(只提醒)", () => {
  it("已給 + 在途 + 這次叫的 超過預計 → 超過幾本", () => {
    expect(
      allocationExcessOf({
        plannedBooks: 10,
        givenBooks: 8,
        inTransitBooks: 1,
        books: 2,
      }),
    ).toBe(1);
  });

  it("沒超過、沒設定預計 → 0", () => {
    expect(
      allocationExcessOf({
        plannedBooks: 10,
        givenBooks: 8,
        inTransitBooks: 0,
        books: 2,
      }),
    ).toBe(0);
    expect(
      allocationExcessOf({
        plannedBooks: null,
        givenBooks: 80,
        inTransitBooks: 0,
        books: 2,
      }),
    ).toBe(0);
  });

  it("這次沒叫(0 本)不提醒", () => {
    expect(
      allocationExcessOf({
        plannedBooks: 1,
        givenBooks: 5,
        inTransitBooks: 0,
        books: 0,
      }),
    ).toBe(0);
  });
});

describe("叫貨單的明細存值 → 副本列", () => {
  it("取遊戲 id 與本數;本數 0 或空的列不寫入", () => {
    expect(
      requisitionLinesOf({
        lines: [
          { rowId: "r1", game: { id: "g1", label: "金好運" }, books: "2" },
          { rowId: "r2", game: { id: "g2", label: "鼠來寶" }, books: "0" },
          { rowId: "r3", game: "g3", books: 1, note: "急" },
          { rowId: "r4", game: null, books: "3" },
          { rowId: "r5", game: { id: "g5", label: null }, books: null },
        ],
      }),
    ).toEqual([
      { gameId: "g1", books: 2, note: null },
      { gameId: "g3", books: 1, note: "急" },
    ]);
  });

  it("同一個遊戲出現兩列 → 合併本數", () => {
    expect(
      requisitionLinesOf({
        lines: [
          { rowId: "r1", game: { id: "g1" }, books: "2" },
          { rowId: "r2", game: { id: "g1" }, books: "3", note: "補" },
        ],
      }),
    ).toEqual([{ gameId: "g1", books: 5, note: "補" }]);
  });

  it("沒有明細 → 空陣列", () => {
    expect(requisitionLinesOf({})).toEqual([]);
    expect(requisitionLinesOf({ lines: null })).toEqual([]);
  });
});
