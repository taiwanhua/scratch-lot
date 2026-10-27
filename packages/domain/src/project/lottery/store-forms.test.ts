import { describe, expect, it } from "@jest/globals";

import {
  cashCorrectionProblemOf,
  cashCorrectionValuesOf,
  refundDefaultOf,
  saleReversalProblemOf,
  saleReversalRefundAmountOf,
  saleReversalValuesOf,
  shiftLabelOf,
  signedCorrectionAmount,
} from "./store-forms";

describe("撤銷售出申請的存值(規格 8.5)", () => {
  const stored = {
    branch: { id: "org-1", label: "中山店" },
    lines: [
      {
        rowId: "r1",
        book: { id: "book-1", label: "5164-0056527" },
        ticket_nos: "012-014,020",
        tickets: 4,
        amount: 800,
      },
      { rowId: "r2", book: null, ticket_nos: "001", tickets: 1 },
    ],
    reason: { value: "customer-return", label: "客人退貨" },
    refund: { value: "yes", label: "是" },
    refund_shift: { id: "shift-1", label: "店內櫃台" },
    refund_amount: 800,
    note: "  ",
  };

  it("解析分店、每本的張號、原因、退款與退款班次;沒有本的列略過", () => {
    expect(saleReversalValuesOf(stored)).toEqual({
      branchId: "org-1",
      lines: [
        {
          rowId: "r1",
          bookId: "book-1",
          ticketNos: ["012", "013", "014", "020"],
          tickets: 4,
          amount: 800,
        },
      ],
      reasonKey: "customer-return",
      refund: true,
      refundShiftId: "shift-1",
      refundAmount: 800,
      note: null,
    });
  });

  it("退款 = 是時退款班次必填;張數要和張號一致", () => {
    const values = saleReversalValuesOf(stored);
    expect(saleReversalProblemOf(values)).toBeNull();
    expect(saleReversalProblemOf({ ...values, refundShiftId: null })).toEqual({
      field: "refund_shift",
    });
    expect(
      saleReversalProblemOf({
        ...values,
        refund: false,
        refundShiftId: null,
      }),
    ).toBeNull();
    expect(
      saleReversalProblemOf({
        ...values,
        lines: values.lines.map((line) => ({ ...line, tickets: 3 })),
      }),
    ).toEqual({ field: "lines" });
    expect(saleReversalProblemOf({ ...values, lines: [] })).toEqual({
      field: "lines",
    });
  });

  it("客人退貨帶入退款 = 是,其他(含租戶新增的原因)= 否", () => {
    expect(refundDefaultOf("customer-return")).toBe(true);
    expect(refundDefaultOf("wrong-ticket")).toBe(false);
    expect(refundDefaultOf("tenant-added")).toBe(false);
    expect(refundDefaultOf(null)).toBe(false);
  });

  it("退款金額 = 面額 × 張數的合計", () => {
    expect(
      saleReversalRefundAmountOf([
        { unitPrice: 200, tickets: 5 },
        { unitPrice: 100, tickets: 1 },
      ]),
    ).toBe(1100);
  });
});

describe("現金更正單的存值(規格 8.8)", () => {
  const stored = {
    branch: "org-1",
    direction: { value: "increase", label: "現金增加" },
    amount: 500,
    place: { value: "drawer", label: "某一班的抽屜" },
    shift: { id: "shift-1", label: "店內櫃台" },
    attributed_shift: null,
    reason: { value: "customer-top-up", label: "客人補付" },
    note: "客人回來補付少給的 500",
  };

  it("解析方向、金額、位置與班次;位置是抽屜時班次必填", () => {
    const values = cashCorrectionValuesOf(stored);
    expect(values).toEqual({
      branchId: "org-1",
      direction: "increase",
      amount: 500,
      place: "drawer",
      shiftId: "shift-1",
      attributedShiftId: null,
      reasonKey: "customer-top-up",
      note: "客人回來補付少給的 500",
    });
    expect(cashCorrectionProblemOf(values)).toBeNull();
    expect(cashCorrectionProblemOf({ ...values, shiftId: null })).toEqual({
      field: "shift",
    });
    expect(
      cashCorrectionProblemOf({ ...values, place: "vault", shiftId: null }),
    ).toBeNull();
  });

  it("金額要是正整數、說明必填、方向看不懂不收", () => {
    const values = cashCorrectionValuesOf(stored);
    expect(cashCorrectionProblemOf({ ...values, amount: 0 })).toEqual({
      field: "amount",
    });
    expect(cashCorrectionProblemOf({ ...values, amount: 1.5 })).toEqual({
      field: "amount",
    });
    expect(cashCorrectionProblemOf({ ...values, note: null })).toEqual({
      field: "note",
    });
    expect(
      cashCorrectionValuesOf({ ...stored, direction: "sideways" }).direction,
    ).toBeNull();
  });

  it("增加 +、減少 −", () => {
    expect(signedCorrectionAmount("increase", 500)).toBe(500);
    expect(signedCorrectionAmount("decrease", 500)).toBe(-500);
  });
});

describe("收銀班次的顯示名稱", () => {
  it("收銀點 · 負責人 開班時間(租戶時區)", () => {
    expect(
      shiftLabelOf({
        cashPointName: "店內櫃台",
        ownerName: "李小華",
        openedAt: new Date("2026-10-21T05:05:00Z"),
        timezone: "Asia/Taipei",
      }),
    ).toBe("店內櫃台 · 李小華 10/21 13:05");
  });
});
