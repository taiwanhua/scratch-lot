import { describe, expect, it } from "@jest/globals";

import {
  STOCKTAKE_DIFF_ACTION,
  STOCKTAKE_STOCK_LINE,
  type StocktakeDraft,
  type StocktakeTicketFacts,
  parseStocktakeDraft,
  serializeStocktakeDraft,
  stocktakeActionProblemsOf,
  stocktakeDiffsOf,
  stocktakeTicketFactsOf,
} from "./stocktake";

const facts = (
  ticketNo: string,
  overrides: Partial<StocktakeTicketFacts> = {},
): StocktakeTicketFacts => ({
  ticketId: `t-${ticketNo}`,
  ticketNo,
  atCount: "unsold",
  changedSince: false,
  ownBackfillOnly: false,
  pendingReversal: false,
  ...overrides,
});

const draft = (overrides: Partial<StocktakeDraft> = {}): StocktakeDraft => ({
  version: 1,
  orgId: "org-1",
  scopeCashPointId: null,
  startedAt: "2026-11-05T13:40:00.000Z",
  lines: [
    {
      bookId: "book-1",
      cashPointId: "cp-1",
      countedAt: "2026-11-05T13:41:00.000Z",
      method: "grid",
      presentTicketNos: ["011", "013"],
      diffs: [{ ticketNo: "012", action: "investigate", eventId: null }],
    },
  ],
  unopened: [{ bookId: "book-2", present: false }],
  lostReview: [
    { ticketId: "t-x", action: "lost", reasonKey: "other", reasonNote: "x" },
  ],
  ...overrides,
});

describe("盤點的差異(規格 6.8、第 17 章第 1、2、6 題)", () => {
  it("系統未售、實際不在 → 差異「未售不在」;系統已售、實際還在 → 「已售還在」", () => {
    const diffs = stocktakeDiffsOf(
      [
        facts("011"),
        facts("012"),
        facts("013", { atCount: "sold" }),
        facts("014", { atCount: "sold" }),
      ],
      ["011", "013"],
    );
    expect(diffs).toEqual([
      {
        ticketId: "t-012",
        ticketNo: "012",
        kind: "missing",
        backfilled: false,
      },
      { ticketId: "t-013", ticketNo: "013", kind: "extra", backfilled: false },
    ]);
  });

  it("第 2 題:盤到那一刻未售、在 → 之後才賣出也不算差異", () => {
    expect(
      stocktakeDiffsOf([facts("012", { changedSince: true })], ["012"]),
    ).toEqual([]);
  });

  it("第 1 題:盤點之後被別人處理(別人補登、看板補刷)→ 不再列為差異;自己補登的照列", () => {
    expect(
      stocktakeDiffsOf([facts("012", { changedSince: true })], []),
    ).toEqual([]);
    expect(
      stocktakeDiffsOf(
        [facts("012", { changedSince: true, ownBackfillOnly: true })],
        [],
      ),
    ).toEqual([
      { ticketId: "t-012", ticketNo: "012", kind: "missing", backfilled: true },
    ]);
  });

  it("撤銷審核中的張不算差異;不在這個收銀點的張不比對", () => {
    expect(
      stocktakeDiffsOf(
        [
          facts("012", { atCount: "sold", pendingReversal: true }),
          facts("013", { atCount: "absent" }),
        ],
        ["012", "013"],
      ),
    ).toEqual([]);
  });
});

const counter = (status: "unsold" | "sold", cashPointId = "cp-1") => ({
  status,
  locationKind: "counter" as const,
  cashPointId,
});

describe("盤點那一刻的系統狀態(以張數事件倒推)", () => {
  const at = new Date("2026-11-05T13:40:00Z");

  it("盤點之後沒有事件 → 目前的狀態", () => {
    expect(
      stocktakeTicketFactsOf(
        {
          ticketId: "t1",
          ticketNo: "001",
          current: counter("unsold"),
          lockRefType: null,
        },
        [],
        "cp-1",
        at,
        new Set(),
      ),
    ).toMatchObject({ atCount: "unsold", changedSince: false });
  });

  it("盤點之後售出 → 盤點那一刻是未售(第一筆之後事件的 from)", () => {
    expect(
      stocktakeTicketFactsOf(
        {
          ticketId: "t1",
          ticketNo: "001",
          current: counter("sold"),
          lockRefType: null,
        },
        [
          {
            eventId: "t1:3",
            at: new Date("2026-11-05T13:45:00Z"),
            from: counter("unsold"),
          },
        ],
        "cp-1",
        at,
        new Set(),
      ),
    ).toMatchObject({
      atCount: "unsold",
      changedSince: true,
      ownBackfillOnly: false,
    });
  });

  it("之後的事件都是這次盤點自己補登的 → ownBackfillOnly", () => {
    expect(
      stocktakeTicketFactsOf(
        {
          ticketId: "t1",
          ticketNo: "001",
          current: counter("sold"),
          lockRefType: null,
        },
        [
          {
            eventId: "t1:3",
            at: new Date("2026-11-05T13:45:00Z"),
            from: counter("unsold"),
          },
        ],
        "cp-1",
        at,
        new Set(["t1:3"]),
      ),
    ).toMatchObject({ ownBackfillOnly: true });
  });

  it("在別的收銀點、被調貨鎖定 → absent;撤銷售出申請鎖定 → 撤銷審核中", () => {
    const base = {
      ticketId: "t1",
      ticketNo: "001",
      current: counter("unsold", "cp-2"),
      lockRefType: null,
    };
    expect(
      stocktakeTicketFactsOf(base, [], "cp-1", at, new Set()).atCount,
    ).toBe("absent");
    expect(
      stocktakeTicketFactsOf(
        { ...base, current: counter("unsold"), lockRefType: "transfer" },
        [],
        "cp-1",
        at,
        new Set(),
      ).atCount,
    ).toBe("absent");
    expect(
      stocktakeTicketFactsOf(
        { ...base, current: counter("sold"), lockRefType: "sale_reversal" },
        [],
        "cp-1",
        at,
        new Set(),
      ),
    ).toMatchObject({ atCount: "sold", pendingReversal: true });
  });
});

describe("差異的處理", () => {
  const diffs = [
    {
      ticketId: "t-012",
      ticketNo: "012",
      kind: "missing" as const,
      backfilled: true,
    },
    {
      ticketId: "t-013",
      ticketNo: "013",
      kind: "extra" as const,
      backfilled: false,
    },
  ];

  it("每筆都處理、處理方式合乎差異 → 沒有問題", () => {
    expect(
      stocktakeActionProblemsOf(diffs, [
        { ticketNo: "012", action: STOCKTAKE_DIFF_ACTION.saleBackfill },
        { ticketNo: "013", action: STOCKTAKE_DIFF_ACTION.flag },
      ]),
    ).toEqual({ stale: [], unhandled: [] });
  });

  it("按了補登售出卻沒有補登 / 已補登卻改成待查 → stale", () => {
    const missing = diffs.slice(0, 1).map((diff) => ({
      ...diff,
      backfilled: false,
    }));
    expect(
      stocktakeActionProblemsOf(missing, [
        { ticketNo: "012", action: STOCKTAKE_DIFF_ACTION.saleBackfill },
      ]).stale,
    ).toEqual(["012"]);
    expect(
      stocktakeActionProblemsOf(diffs.slice(0, 1), [
        { ticketNo: "012", action: STOCKTAKE_DIFF_ACTION.investigate },
      ]).stale,
    ).toEqual(["012"]);
  });

  it("差異已不存在(已被處理)→ stale;沒有處理 → unhandled;處理方式不合 → stale", () => {
    expect(
      stocktakeActionProblemsOf(diffs, [
        { ticketNo: "011", action: STOCKTAKE_DIFF_ACTION.investigate },
        { ticketNo: "013", action: STOCKTAKE_DIFF_ACTION.investigate },
      ]),
    ).toEqual({ stale: ["011", "013"], unhandled: ["012", "013"] });
  });
});

describe("盤點內容的序列化", () => {
  it("來回一致", () => {
    const value = draft();
    expect(parseStocktakeDraft(serializeStocktakeDraft(value))).toEqual({
      ok: true,
      draft: value,
    });
  });

  it("形狀不對 → 錯誤", () => {
    expect(parseStocktakeDraft("not json").ok).toBe(false);
    expect(parseStocktakeDraft(JSON.stringify({ version: 2 })).ok).toBe(false);
    const bad = { ...draft(), lines: [{ bookId: 1 }] };
    expect(parseStocktakeDraft(JSON.stringify(bad)).ok).toBe(false);
    const badAction = draft({
      lostReview: [{ ticketId: "t", action: "nope" as "lost" }],
    });
    expect(parseStocktakeDraft(JSON.stringify(badAction)).ok).toBe(false);
  });
});

const stock = (status: "unsold" | "investigating") => ({
  status,
  locationKind: "stock" as const,
  cashPointId: null,
});

describe("拆過、在庫存的張那一區(使用者 10/27 要求)", () => {
  const at = new Date("2026-11-05T13:40:00Z");

  it("庫存那一行比對那一刻在庫存的未售張;檯面的張、被調貨鎖住的張不比對", () => {
    const factsOf = (
      current: ReturnType<typeof stock> | ReturnType<typeof counter>,
      lockRefType: string | null = null,
    ) =>
      stocktakeTicketFactsOf(
        { ticketId: "t1", ticketNo: "001", current, lockRefType },
        [],
        STOCKTAKE_STOCK_LINE,
        at,
        new Set(),
      ).atCount;
    expect(factsOf(stock("unsold"))).toBe("unsold");
    expect(factsOf(stock("investigating"))).toBe("absent");
    expect(factsOf(counter("unsold"))).toBe("absent");
    expect(factsOf(stock("unsold"), "transfer")).toBe("absent");
  });

  it("庫存的張不在只能待查(沒有補登售出)", () => {
    const missing = [
      {
        ticketId: "t1",
        ticketNo: "001",
        kind: "missing" as const,
        backfilled: false,
      },
    ];
    expect(
      stocktakeActionProblemsOf(
        missing,
        [{ ticketNo: "001", action: STOCKTAKE_DIFF_ACTION.investigate }],
        STOCKTAKE_STOCK_LINE,
      ),
    ).toEqual({ stale: [], unhandled: [] });
    expect(
      stocktakeActionProblemsOf(
        missing,
        [{ ticketNo: "001", action: STOCKTAKE_DIFF_ACTION.saleBackfill }],
        STOCKTAKE_STOCK_LINE,
      ).stale,
    ).toEqual(["001"]);
  });
});
