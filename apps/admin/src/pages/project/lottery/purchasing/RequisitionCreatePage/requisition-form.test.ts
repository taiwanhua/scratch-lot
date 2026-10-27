import { describe, expect, it } from "@jest/globals";

import {
  type Candidate,
  EMPTY_FILTERS,
  excessOf,
  parseBooks,
  requisitionValuesOf,
  totalsOf,
  unitPricesOf,
  visibleCandidates,
} from "./requisition-form";

const candidate = (
  overrides: Partial<Candidate> & Pick<Candidate, "gameId" | "gameCode">,
): Candidate => ({
  __typename: "LotteryRequisitionCandidate",
  name: `遊戲 ${overrides.gameCode}`,
  unitPrice: 200,
  bookPrice: 20_000,
  defaultRate: 92,
  launchedAt: null,
  isNew: false,
  stockTickets: 0,
  inTransitBooks: 0,
  sold7: 0,
  sold30: 0,
  plannedBooks: null,
  givenBooks: 0,
  ...overrides,
});

const ROWS = [
  candidate({ gameId: "g1", gameCode: "5201", name: "金好運", isNew: true }),
  candidate({ gameId: "g2", gameCode: "5198", name: "鼠來寶", unitPrice: 100 }),
  candidate({
    gameId: "g3",
    gameCode: "5133",
    name: "招財貓",
    unitPrice: 1000,
    bookPrice: 25_000,
    plannedBooks: 10,
    givenBooks: 9,
  }),
];

describe("叫貨單新增頁(規格 8.1)", () => {
  it("搜尋名稱或代號、面額篩選、只看要叫的", () => {
    const counts = { g1: 2 };
    const ids = (filters = EMPTY_FILTERS) =>
      visibleCandidates(ROWS, counts, filters).map((row) => row.gameId);
    expect(ids()).toEqual(["g1", "g2", "g3"]);
    expect(ids({ ...EMPTY_FILTERS, keyword: "招財" })).toEqual(["g3"]);
    expect(ids({ ...EMPTY_FILTERS, keyword: "519" })).toEqual(["g2"]);
    expect(ids({ ...EMPTY_FILTERS, unitPrice: 100 })).toEqual(["g2"]);
    expect(ids({ ...EMPTY_FILTERS, onlyOrdered: true })).toEqual(["g1"]);
    expect(unitPricesOf(ROWS)).toEqual([100, 200, 1000]);
  });

  it("合計:共叫幾本、預估批購金額(整本金額 × 預設批購金額率 × 本數)", () => {
    expect(totalsOf(ROWS, { g1: 2, g3: 1 })).toEqual({
      books: 3,
      amount: 59_800,
    });
    expect(totalsOf(ROWS, {})).toEqual({ books: 0, amount: 0 });
  });

  it("超過預計要給本數只提醒:已給 + 在途 + 叫的 − 預計", () => {
    const lucky = ROWS.find((row) => row.gameId === "g3");
    if (lucky === undefined) {
      throw new Error("夾具沒有 g3");
    }
    expect(excessOf(lucky, { g3: 2 })).toBe(1);
    expect(excessOf(lucky, { g3: 1 })).toBe(0);
  });

  it("組成表單存值:0 本的列不寫入", () => {
    expect(
      requisitionValuesOf(
        { branchId: "org-a", expectedDate: null },
        ROWS,
        { g1: 2, g2: 0, g3: 1 },
        (gameId) => `row-${gameId}`,
      ),
    ).toEqual({
      branch: "org-a",
      expected_date: null,
      lines: [
        { rowId: "row-g1", game: { id: "g1", label: "金好運" }, books: 2 },
        { rowId: "row-g3", game: { id: "g3", label: "招財貓" }, books: 1 },
      ],
    });
  });

  it("叫幾本的輸入:空白、負數、小數當 0", () => {
    expect(parseBooks("3")).toBe(3);
    expect(parseBooks("")).toBe(0);
    expect(parseBooks("-1")).toBe(0);
    expect(parseBooks("1.5")).toBe(0);
  });
});
