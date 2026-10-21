import { describe, expect, it } from "@jest/globals";

import {
  accountNoTail,
  bankAccountLabel,
  cashEffectOn,
  documentRequirementOf,
  fixedDirectionOf,
  isCashRouteAllowed,
  isSettlementCleared,
  outstandingKindOf,
  paidNetOf,
  payeeDefaultAmount,
  payerDefaultAmount,
  pendingPayeeAmount,
  requiresBranch,
  requiresSummary,
} from ".";

describe("銀行交易類型(規格 10.1)", () => {
  it("收 / 支固定;調整、其他由使用者選且說明必填", () => {
    expect(fixedDirectionOf("deposit")).toBe("in");
    expect(fixedDirectionOf("redemption_income")).toBe("in");
    expect(fixedDirectionOf("purchase_expense")).toBe("out");
    expect(fixedDirectionOf("license_rent")).toBe("out");
    expect(fixedDirectionOf("adjustment")).toBeNull();
    expect(requiresSummary("other")).toBe(true);
    expect(requiresSummary("deposit")).toBe(false);
  });

  it("批貨與調貨歸屬分店必填;批貨收入 / 調貨收入單據必填、兌獎入帳選填", () => {
    expect(requiresBranch("purchase_income")).toBe(true);
    expect(requiresBranch("transfer_expense")).toBe(true);
    expect(requiresBranch("deposit")).toBe(false);
    expect(documentRequirementOf("purchase_income")).toBe("required");
    expect(documentRequirementOf("transfer_income")).toBe("required");
    expect(documentRequirementOf("redemption_income")).toBe("optional");
    expect(documentRequirementOf("withdrawal")).toBe("none");
  });

  it("lookup 顯示戶名 + 帳號末 5 碼", () => {
    expect(accountNoTail("0123-456-12345")).toBe("12345");
    expect(
      bankAccountLabel({
        accountName: "好運彩券行",
        accountNo: "0123-4567-34521",
      }),
    ).toBe("好運彩券行 末 34521");
  });
});

describe("現金流水(規格 10.2)", () => {
  it("每種類型只能走表上的從 → 到", () => {
    expect(isCashRouteAllowed("withdraw", "vault", "drawer")).toBe(true);
    expect(isCashRouteAllowed("withdraw", "drawer", "vault")).toBe(false);
    expect(isCashRouteAllowed("transfer_out", "vault", "external")).toBe(true);
    expect(isCashRouteAllowed("transfer_out", "drawer", "external")).toBe(true);
    expect(isCashRouteAllowed("refund", "vault", "external")).toBe(false);
    expect(isCashRouteAllowed("bank_deposit", "vault", "bank")).toBe(true);
  });

  it("對某個地方的影響:流入 +、流出 −", () => {
    const movement = {
      from: "vault" as const,
      to: "drawer" as const,
      amount: 500,
    };
    expect(cashEffectOn("vault", movement)).toBe(-500);
    expect(cashEffectOn("drawer", movement)).toBe(500);
    expect(cashEffectOn("bank", movement)).toBe(0);
  });
});

describe("收付機制(規格第 9 章的驗算表)", () => {
  // 進貨單:送出時已自動記「批貨支出」= 扣款金額
  it.each([
    // [情境, 應付, 已付, 付款預設, 收到退款預設]
    ["① 全部點收", 17_000, 17_000, 0, 0],
    ["② 還沒點收", 17_000, 17_000, 0, 0],
    ["③ 少一本退回刪掉再送出", 7800, 17_000, 0, 9200],
    ["④ 退回後多加一本", 26_400, 17_200, 9200, 0],
    ["⑤ 兌獎大於批購(兌獎入帳不算)", 0, 0, 0, 0],
  ])("%s", (_name, payable, paid, payDefault, refundDefault) => {
    const totals = { out: paid, in: 0 };
    expect(payerDefaultAmount("out", payable, totals)).toBe(payDefault);
    expect(payerDefaultAmount("in", payable, totals)).toBe(refundDefault);
  });

  it("已付淨額 = 支出 − 收入;分次付款", () => {
    expect(paidNetOf({ out: 6000 + 2000, in: 0 })).toBe(8000);
    expect(paidNetOf({ out: 10_000, in: 2000 })).toBe(8000);
  });

  it("調貨單例(5 本 × 2,000,第 5 本遺失 → 調貨金額 8,000)", () => {
    const amount = 8000;
    // 步驟 2:B 店付現 10,000
    let payer = { out: 10_000, in: 0 };
    let payee = { out: 0, in: 0 };
    expect(payeeDefaultAmount("in", amount, payer, payee)).toBe(10_000);
    expect(payerDefaultAmount("in", amount, payer)).toBe(2000);
    expect(pendingPayeeAmount(payer, payee)).toBe(10_000);
    // 步驟 3:A 店收款 10,000
    payee = { out: 0, in: 10_000 };
    expect(payeeDefaultAmount("out", amount, payer, payee)).toBe(2000);
    // 步驟 4:A 店退款 2,000 → 已收 8,000 = 調貨金額,[收款] [退款] 都停用
    payee = { out: 2000, in: 10_000 };
    expect(payeeDefaultAmount("in", amount, payer, payee)).toBe(0);
    expect(payeeDefaultAmount("out", amount, payer, payee)).toBe(0);
    // 步驟 5:B 店收到退款 2,000 → 全部停用
    payer = { out: 10_000, in: 2000 };
    expect(payerDefaultAmount("in", amount, payer)).toBe(0);
    expect(payerDefaultAmount("out", amount, payer)).toBe(0);
  });

  it("分次付款例:A [收款] 先填 = 收貨店已付 − 出貨店已收", () => {
    const amount = 8000;
    expect(
      payeeDefaultAmount("in", amount, { out: 6000, in: 0 }, { out: 0, in: 0 }),
    ).toBe(6000);
    expect(
      payeeDefaultAmount(
        "in",
        amount,
        { out: 6000, in: 0 },
        { out: 0, in: 6000 },
      ),
    ).toBe(0);
    expect(
      payeeDefaultAmount(
        "in",
        amount,
        { out: 8000, in: 0 },
        { out: 0, in: 6000 },
      ),
    ).toBe(2000);
  });

  it("待結清種類:付款方待付 / 待退、收款方待收 / 待退;都 0 = 已結清", () => {
    expect(outstandingKindOf("payer", { out: 9200, in: 0 })).toEqual({
      kind: "to_pay",
      button: "out",
      amount: 9200,
    });
    expect(outstandingKindOf("payer", { out: 0, in: 2000 })?.kind).toBe(
      "to_refund",
    );
    expect(outstandingKindOf("payee", { out: 0, in: 1840 })?.kind).toBe(
      "to_receive",
    );
    expect(outstandingKindOf("payee", { out: 0, in: 0 })).toBeNull();
  });

  it("作廢 / 駁回前每一邊淨額都要是 0", () => {
    expect(
      isSettlementCleared({ payable: 100, sides: { hq: { out: 0, in: 0 } } }),
    ).toBe(true);
    expect(
      isSettlementCleared({
        payable: 100,
        sides: { hq: { out: 100, in: 100 } },
      }),
    ).toBe(true);
    expect(
      isSettlementCleared({ payable: 100, sides: { hq: { out: 100, in: 0 } } }),
    ).toBe(false);
  });
});
