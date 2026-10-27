import { describe, expect, it } from "@jest/globals";

import {
  CHECKOUT_DENOMINATIONS,
  type CheckoutDraft,
  checkoutHandoverProblemOf,
  countedTotalOf,
  expectedCashTotalOf,
  isDiffReasonRequired,
  parseCheckoutDraft,
  serializeCheckoutDraft,
} from "./checkout";

const stocktakeDraft = {
  version: 1 as const,
  orgId: "org-1",
  scopeCashPointId: "cp-1",
  startedAt: "2026-10-16T13:40:00.000Z",
  lines: [],
  unopened: [],
  lostReview: [],
};

const draft: CheckoutDraft = {
  version: 1,
  type: "shift",
  orgId: "org-1",
  shiftId: "shift-1",
  cashPointId: "cp-1",
  stocktake: { mode: "new", draft: stocktakeDraft },
  denominations: [
    { value: 1000, count: 8 },
    { value: 500, count: 3 },
    { value: 100, count: 18 },
    { value: 50, count: 6 },
    { value: 10, count: 37 },
    { value: 5, count: 12 },
    { value: 1, count: 20 },
  ],
  diffReasonKey: "wrong-change",
  diffReasonNote: null,
  leftForNext: 3000,
  successorId: "user-2",
};

describe("結帳內容(規格 6.9)", () => {
  it("序列化後讀得回來;三種盤點方式都收", () => {
    expect(parseCheckoutDraft(serializeCheckoutDraft(draft))).toEqual({
      ok: true,
      draft,
    });
    const reuse: CheckoutDraft = {
      ...draft,
      stocktake: { mode: "reuse", submissionId: "sub-1" },
    };
    expect(parseCheckoutDraft(serializeCheckoutDraft(reuse))).toEqual({
      ok: true,
      draft: reuse,
    });
    const skip: CheckoutDraft = {
      ...draft,
      stocktake: { mode: "skip", reasonKey: "short-staffed", reasonNote: null },
    };
    expect(parseCheckoutDraft(serializeCheckoutDraft(skip))).toEqual({
      ok: true,
      draft: skip,
    });
  });

  it("形狀不對 → 讀不懂(不是 JSON、沒有班、面額不是整數、跳過沒有原因、盤點方式不認得)", () => {
    expect(parseCheckoutDraft("{")).toEqual({ ok: false, problem: "not_json" });
    expect(parseCheckoutDraft({ ...draft, shiftId: "" })).toMatchObject({
      ok: false,
      problem: "header",
    });
    expect(
      parseCheckoutDraft({
        ...draft,
        denominations: [{ value: 1000, count: 1.5 }],
      }),
    ).toMatchObject({ ok: false, problem: "denominations" });
    expect(
      parseCheckoutDraft({
        ...draft,
        stocktake: { mode: "skip", reasonKey: "" },
      }),
    ).toMatchObject({ ok: false, problem: "stocktake" });
    expect(
      parseCheckoutDraft({ ...draft, stocktake: { mode: "later" } }),
    ).toMatchObject({ ok: false, problem: "stocktake" });
  });

  it("實點 = 各面額 × 張數的合計;面額表七種", () => {
    expect(CHECKOUT_DENOMINATIONS).toEqual([1000, 500, 100, 50, 10, 5, 1]);
    expect(countedTotalOf(draft.denominations)).toBe(12_050);
    expect(countedTotalOf([])).toBe(0);
  });

  it("應有 = 各項金額加總(每項已帶正負號)", () => {
    expect(
      expectedCashTotalOf([
        { kind: "opening", amount: 3000 },
        { kind: "sales", amount: 14_550 },
        { kind: "redemptions", amount: -1200 },
        { kind: "deposits", amount: -4000 },
      ]),
    ).toBe(12_350);
  });

  it("差額不為 0 時原因必填", () => {
    expect(isDiffReasonRequired(0)).toBe(false);
    expect(isDiffReasonRequired(-300)).toBe(true);
    expect(isDiffReasonRequired(50)).toBe(true);
  });

  it("交接(規格 6.9):留給下一班 > 0 要接班人;沒有接班人必須是 0;金額要是非負整數;不超過實點", () => {
    expect(
      checkoutHandoverProblemOf({
        leftForNext: 3000,
        successorId: "user-2",
        counted: 2999,
      }),
    ).toBe("exceeds_counted");
    expect(
      checkoutHandoverProblemOf({
        leftForNext: 3000,
        successorId: "user-2",
        counted: 3000,
      }),
    ).toBeNull();
    expect(
      checkoutHandoverProblemOf({ leftForNext: 3000, successorId: "user-2" }),
    ).toBeNull();
    expect(
      checkoutHandoverProblemOf({ leftForNext: 0, successorId: null }),
    ).toBeNull();
    expect(
      checkoutHandoverProblemOf({ leftForNext: 3000, successorId: null }),
    ).toBe("must_be_zero");
    expect(
      checkoutHandoverProblemOf({ leftForNext: -1, successorId: "user-2" }),
    ).toBe("invalid_amount");
    expect(
      checkoutHandoverProblemOf({ leftForNext: 10.5, successorId: "user-2" }),
    ).toBe("invalid_amount");
  });
});
