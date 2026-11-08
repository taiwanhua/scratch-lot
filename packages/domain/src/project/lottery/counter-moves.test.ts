import { describe, expect, it } from "@jest/globals";

import {
  type CounterScanContext,
  type CounterScanTicketFacts,
  counterScanDecisionOf,
  counterScanMatchPlacesOf,
  moveByCountProblemOf,
  movePauseBlockOf,
  scrapBlockOf,
  splitNeedsActualCount,
  splitSkipCountOf,
} from "./counter-moves";

const A = "cash-point-a";
const B = "cash-point-b";
const C = "cash-point-c";

const onA: CounterScanTicketFacts = {
  inThisStore: true,
  status: "unsold",
  unmatched: false,
  locked: false,
  locationKind: "counter",
  cashPointId: A,
};

const recallFromA = (
  countMode: CounterScanContext["countMode"] = "count",
): CounterScanContext => ({
  countMode,
  sourceCashPointId: A,
  targetCashPointId: null,
});

const moveAToB = (
  countMode: CounterScanContext["countMode"] = "count",
): CounterScanContext => ({
  countMode,
  sourceCashPointId: A,
  targetCashPointId: B,
});

describe("收回 / 刷條碼移櫃刷到一張(張數店規格 6.3、7.6、7.7;16.6 R1、R2)", () => {
  it("張數店:這台檯面上的未售 → 照現況,不對號", () => {
    expect(counterScanDecisionOf(onA, recallFromA(), false)).toEqual({
      problem: null,
      match: false,
      fromCashPointId: A,
    });
    expect(counterScanMatchPlacesOf(onA, recallFromA())).toBeNull();
  });

  it.each([
    ["已售·未對號", { status: "sold", unmatched: true, cashPointId: B }],
    ["待查·未對號", { status: "investigating", unmatched: true }],
    ["遺失·未對號", { status: "lost", unmatched: true }],
    ["系統記在別台的未售", { cashPointId: B }],
  ] as const)(
    "張數店:%s → 在來源台找配對;有配對 → 先對號、從來源台移出",
    (_label, patch) => {
      const ticket = { ...onA, ...patch };
      expect(counterScanMatchPlacesOf(ticket, moveAToB())).toEqual([
        { locationKind: "counter", cashPointId: A },
      ]);
      expect(counterScanDecisionOf(ticket, moveAToB(), true)).toEqual({
        problem: null,
        match: true,
        fromCashPointId: A,
      });
    },
  );

  it.each([
    [
      "已售·未對號",
      { status: "sold", unmatched: true },
      "unmatched_no_partner",
    ],
    ["待查·未對號", { status: "investigating", unmatched: true }, "missing"],
  ] as const)("張數店:%s 找不到配對 → %s", (_label, patch, problem) => {
    expect(
      counterScanDecisionOf({ ...onA, ...patch }, recallFromA(), false),
    ).toMatchObject({ problem, match: false });
  });

  it("張數店:系統記在別台的未售、來源台沒有配對 → 照現況從系統記的那台移出", () => {
    expect(
      counterScanDecisionOf({ ...onA, cashPointId: C }, moveAToB(), false),
    ).toEqual({ problem: null, match: false, fromCashPointId: C });
  });

  it("移櫃:實際移出的收銀點就是要移到的那台 → already_there", () => {
    expect(
      counterScanDecisionOf({ ...onA, cashPointId: B }, moveAToB(), false),
    ).toMatchObject({ problem: "already_there" });
  });

  it.each([
    ["不是本店", { inThisStore: false }, "not_this_store"],
    ["鎖定(不對號)", { locked: true, cashPointId: B }, "locked"],
    ["跳號", { status: "skipped" }, "skipped"],
    ["報廢", { status: "scrapped" }, "scrapped"],
    ["確定的已售", { status: "sold" }, "sold"],
    ["確定的待查", { status: "investigating" }, "missing"],
    [
      "在庫存(張號一定對,不拿來對號)",
      { locationKind: "stock", cashPointId: null },
      "in_stock",
    ],
    ["在途", { locationKind: "in_transit", cashPointId: null }, "in_transit"],
  ] as const)("張數店:%s → %s", (_label, patch, problem) => {
    expect(
      counterScanDecisionOf({ ...onA, ...patch }, recallFromA(), true),
    ).toMatchObject({
      problem,
      match: false,
    });
  });

  it("轉換中照張數店規則對號(9.2)", () => {
    const ticket = { ...onA, status: "sold" as const, unmatched: true };
    expect(
      counterScanDecisionOf(ticket, recallFromA("converting"), true),
    ).toMatchObject({
      match: true,
    });
  });

  it("編號店:不對號,只收回 / 移櫃這台的未售;別台的 → not_on_source", () => {
    expect(
      counterScanMatchPlacesOf(
        { ...onA, cashPointId: B },
        recallFromA("numbered"),
      ),
    ).toBeNull();
    expect(counterScanDecisionOf(onA, recallFromA("numbered"), true)).toEqual({
      problem: null,
      match: false,
      fromCashPointId: A,
    });
    expect(
      counterScanDecisionOf(
        { ...onA, cashPointId: B },
        recallFromA("numbered"),
        true,
      ),
    ).toMatchObject({ problem: "not_on_source" });
    expect(
      counterScanDecisionOf(
        { ...onA, status: "sold", unmatched: true },
        recallFromA("numbered"),
        true,
      ),
    ).toMatchObject({ problem: "unmatched_no_partner" });
  });
});

describe("移櫃暫停(8.5a B1 / B2)", () => {
  it("補點編號中 → 全部遊戲暫停", () => {
    expect(movePauseBlockOf([{ gameId: null }], ["x"])).toEqual({
      kind: "renumber",
    });
  });

  it("重刷 X → 只擋 X,其他遊戲照常;X、Y 同時重刷各自擋", () => {
    const pauses = [{ gameId: "x" }, { gameId: "y" }];
    expect(movePauseBlockOf(pauses, ["z"])).toBeNull();
    expect(movePauseBlockOf(pauses, ["z", "y"])).toEqual({
      kind: "rescan",
      gameId: "y",
    });
    expect(movePauseBlockOf([], ["x"])).toBeNull();
  });
});

describe("依張數移櫃(7.7、9.2、16.6 R2)", () => {
  it.each([
    ["張數店 3 張、剩 12", "count", A, B, 3, 12, null],
    [
      "上限 = 來源台這個遊戲的總剩餘",
      "count",
      A,
      B,
      13,
      12,
      { kind: "exceeds", available: 12 },
    ],
    ["張數 0", "count", A, B, 0, 12, { kind: "invalid_count" }],
    ["移到同一台", "count", A, A, 1, 12, { kind: "same_cash_point" }],
    [
      "轉換中不能用",
      "converting",
      A,
      B,
      1,
      12,
      { kind: "not_count_store", countMode: "converting" },
    ],
    [
      "編號店不能用",
      "numbered",
      A,
      B,
      1,
      12,
      { kind: "not_count_store", countMode: "numbered" },
    ],
  ] as const)("%s", (_label, mode, from, to, count, available, expected) => {
    expect(moveByCountProblemOf(mode, from, to, count, available)).toEqual(
      expected,
    );
  });
});

describe("拆本的手上實際張數(7.5;16.6 SC3、16.7 S11)", () => {
  it("張數店與轉換中不是原封不動的本才問;原封不動與編號店照現況", () => {
    expect(splitNeedsActualCount("count", false)).toBe(true);
    expect(splitNeedsActualCount("converting", false)).toBe(true);
    expect(splitNeedsActualCount("count", true)).toBe(false);
    expect(splitNeedsActualCount("numbered", false)).toBe(false);
  });

  it.each([
    [
      "CS-08a:系統 20、實際 18、待標註 2 → 標 2 張",
      20,
      18,
      2,
      { ok: true, skipCount: 2 },
    ],
    [
      "整本待查後尋回幾張:差 0 → 直接拆、不要求標滿待標註",
      5,
      5,
      2,
      { ok: true, skipCount: 0 },
    ],
    [
      "CS-08b:少 5 張、待標註 2 → 擋",
      20,
      15,
      2,
      { ok: false, problem: { kind: "short", count: 5 } },
    ],
    [
      "沒有待標註時少 1 張就擋",
      20,
      19,
      0,
      { ok: false, problem: { kind: "short", count: 1 } },
    ],
    [
      "CS-08c:多 2 張 → 擋",
      20,
      22,
      2,
      { ok: false, problem: { kind: "over", count: 2 } },
    ],
    ["輸入不是整數", 20, 1.5, 2, { ok: false, problem: { kind: "invalid" } }],
  ] as const)("%s", (_label, system, actual, pending, expected) => {
    expect(splitSkipCountOf(system, actual, pending)).toEqual(expected);
  });
});

describe("報廢只限庫存、要拆過(7.8;16.6 SC1)", () => {
  const stock = {
    status: "unsold" as const,
    locationKind: "stock" as const,
    locked: false,
    bookFirstOpenedAt: new Date("2026-11-01T00:00:00Z"),
  };
  it.each([
    ["拆過的本、庫存的未售", {}, null],
    ["檯面上的張 → 先收回", { locationKind: "counter" }, "not_in_stock"],
    ["從沒拆過的本", { bookFirstOpenedAt: null }, "book_unopened"],
    ["已售", { status: "sold" }, "not_unsold"],
    ["被調貨單鎖住", { locked: true }, "locked"],
  ] as const)("%s → %s", (_label, patch, expected) => {
    expect(scrapBlockOf({ ...stock, ...patch })).toBe(expected);
  });
});
