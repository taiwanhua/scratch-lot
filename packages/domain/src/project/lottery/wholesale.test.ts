import { describe, expect, it } from "@jest/globals";

import {
  WHOLESALE_PAYMENT_MODE,
  wholesaleAmountOf,
  wholesaleHeaderOf,
  wholesaleLinesOf,
  wholesaleReceivedProblemOf,
  wholesaleTotalOf,
} from "./wholesale";

const line = (over: Record<string, unknown> = {}) => ({
  rowId: "r1",
  game: { id: "g", label: "5164" },
  book: { id: "b", label: "5164-056611" },
  tickets: 100,
  book_price: 20_000,
  rate: 93,
  amount: 18_600,
  ...over,
});

describe("批售單的純函式(規格 21.3、21.4)", () => {
  it("明細存值 → 明細列:沒有 rowId 或沒有本的列略過;合計 = 批售金額", () => {
    const lines = wholesaleLinesOf({
      lines: [
        line(),
        line({ rowId: "r2", book: "b2" }),
        line({ rowId: "r3", book: null }),
        { book: { id: "x" } },
      ],
    });
    expect(lines.map((row) => [row.rowId, row.bookId, row.gameId])).toEqual([
      ["r1", "b", "g"],
      ["r2", "b2", "g"],
    ]);
    expect(wholesaleTotalOf(lines)).toBe(37_200);
    expect(wholesaleLinesOf({})).toEqual([]);
  });

  it("單頭:引用取 id、收款方式只認兩種", () => {
    expect(
      wholesaleHeaderOf({
        from_branch: { id: "o", label: "中山店" },
        customer: { id: "c", label: "好運彩券行 · 0223456789" },
        payment_mode: { value: "auto_bank", label: "從帳戶入帳" },
        account: { id: "a", label: "台銀" },
      }),
    ).toEqual({
      fromBranchId: "o",
      customerId: "c",
      paymentMode: WHOLESALE_PAYMENT_MODE.autoBank,
      accountId: "a",
    });
    expect(wholesaleHeaderOf({ payment_mode: "later" }).paymentMode).toBeNull();
  });

  it.each([
    { out: 0, in: 20_000, problem: { kind: "unreceived", amount: 17_200 } },
    { out: 0, in: 37_500, problem: { kind: "overreceived", amount: 300 } },
    { out: 300, in: 37_500, problem: null },
  ])("已收 $in − $out → $problem", ({ problem, ...totals }) => {
    expect(wholesaleReceivedProblemOf(37_200, totals)).toEqual(problem);
  });

  it("批售金額 = 整本金額 × 批購金額率", () => {
    expect(wholesaleAmountOf(20_000, 93)).toBe(18_600);
  });
});
