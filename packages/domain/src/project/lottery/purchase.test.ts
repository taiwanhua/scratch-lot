import { describe, expect, it } from "@jest/globals";

import {
  PURCHASE_FIELD_KEYS as K,
  type PurchaseLineValue,
  duplicateBookKeysOf,
  groupPurchaseLines,
  matchReceiveScan,
  purchaseAmountOf,
  purchaseHeaderOf,
  purchaseLinesOf,
  purchasePayableOf,
  receivingSummaryOf,
} from "./purchase";

function row(
  rowId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rowId,
    [K.game]: { id: "g1", label: "發大財" },
    [K.bookNo]: "056527",
    [K.lastTicketNo]: 100,
    [K.tickets]: 100,
    [K.bookPrice]: 20_000,
    [K.rate]: 92,
    [K.amount]: 18_400,
    ...overrides,
  };
}

function codeOf(gameId: string): string {
  return gameId === "g1" ? "5164" : "5201";
}

function line(
  rowId: string,
  overrides: Partial<PurchaseLineValue> = {},
): PurchaseLineValue {
  return {
    rowId,
    gameId: "g1",
    bookNo: "0056527",
    lastTicketNo: 100,
    tickets: 100,
    bookPrice: 20_000,
    rate: 92,
    amount: 18_400,
    ...overrides,
  };
}

describe("批購金額(規格 8.2 明細)", () => {
  it("整本金額 × 批購金額率,四捨五入到元", () => {
    expect(purchaseAmountOf(20_000, 92)).toBe(18_400);
    expect(purchaseAmountOf(20_400, 92)).toBe(18_768);
    expect(purchaseAmountOf(10_050, 91)).toBe(9146);
  });
});

describe("明細存值 → 明細列", () => {
  it("本號 6 位自動補 0;批購金額照存值", () => {
    const lines = purchaseLinesOf({
      [K.lines]: [row("r1"), row("r2", { [K.bookNo]: "0056528" })],
    });
    expect(lines.map((item) => item.bookNo)).toEqual(["0056527", "0056528"]);
    expect(lines[0]).toEqual(line("r1"));
  });

  it("沒有遊戲、沒有 rowId 的列略過;本號不合格式 → null(送出時擋)", () => {
    const lines = purchaseLinesOf({
      [K.lines]: [
        row("r1", { [K.game]: null }),
        { [K.bookNo]: "1" },
        row("r3", { [K.bookNo]: "12a" }),
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.bookNo).toBeNull();
  });

  it("不是陣列 → 空", () => {
    expect(purchaseLinesOf({})).toEqual([]);
  });
});

describe("單頭", () => {
  it("引用欄取 id;本人批購 true / false;扣款金額讀計算欄", () => {
    const header = purchaseHeaderOf({
      [K.branch]: { id: "b1", label: "中山店" },
      [K.requisition]: " R-0042 ",
      [K.dealer]: { id: "d1", label: "林甲" },
      [K.selfPurchase]: false,
      [K.trustee]: { id: "c1", label: "林受託" },
      [K.purchaseDate]: "2026-10-12T16:00:00.000Z",
      [K.account]: { id: "a1", label: "台銀" },
    });
    expect(header).toEqual({
      branchId: "b1",
      requisitionNo: "R-0042",
      dealerId: "d1",
      selfPurchase: false,
      trusteeId: "c1",
      purchaseDate: new Date("2026-10-12T16:00:00.000Z"),
      accountId: "a1",
    });
  });

  it("沒填 → null;本人批購沒填視同否", () => {
    expect(purchaseHeaderOf({})).toEqual({
      branchId: null,
      requisitionNo: null,
      dealerId: null,
      selfPurchase: false,
      trusteeId: null,
      purchaseDate: null,
      accountId: null,
    });
  });
});

describe("應付(扣款金額)", () => {
  it("讀計算欄扣款金額;沒有時用批購合計(明細加總)", () => {
    expect(purchasePayableOf({ [K.deductedAmount]: 61_000 })).toBe(61_000);
    expect(
      purchasePayableOf({
        [K.lines]: [row("r1"), row("r2", { [K.amount]: 9200 })],
      }),
    ).toBe(27_600);
  });

  it("負數或非數字 → 0", () => {
    expect(purchasePayableOf({ [K.deductedAmount]: -5 })).toBe(0);
    expect(purchasePayableOf({ [K.deductedAmount]: "x", [K.lines]: [] })).toBe(
      0,
    );
  });
});

describe("依遊戲分組(組標題列小計)", () => {
  it("同一個遊戲一組,順序照第一次出現,小計 = 批購金額加總", () => {
    const groups = groupPurchaseLines([
      line("r1"),
      line("r2", { gameId: "g2", amount: 9200 }),
      line("r3", { amount: 18_400 }),
    ]);
    expect(groups.map((group) => group.gameId)).toEqual(["g1", "g2"]);
    expect(groups[0]?.rows.map((item) => item.rowId)).toEqual(["r1", "r3"]);
    expect(groups[0]?.subtotal).toBe(36_800);
    expect(groups[1]?.subtotal).toBe(9200);
  });
});

describe("同一張單本號重複", () => {
  it("同遊戲同本號 → 回重複的本編號", () => {
    expect(
      duplicateBookKeysOf(
        [line("r1"), line("r2"), line("r3", { gameId: "g2" })],
        codeOf,
      ),
    ).toEqual(["5164-0056527"]);
  });
});

describe("點收刷條碼(規格 8.2 點收一本)", () => {
  const lines = [
    line("r1"),
    line("r2", { bookNo: "0056528", lastTicketNo: 102 }),
    line("r3", { gameId: "g2", bookNo: "0060116" }),
  ];

  it("背面編號:遊戲 + 本號對到、最後張號相同 → 可以點收", () => {
    expect(
      matchReceiveScan(lines, new Set(), "5164-1-056528-102-0-6", codeOf),
    ).toEqual({ kind: "match", row: lines[1] });
  });

  it("正面條碼沒有遊戲代號:只用本號對", () => {
    expect(matchReceiveScan(lines, new Set(), "0060116100", codeOf)).toEqual({
      kind: "match",
      row: lines[2],
    });
  });

  it("最後張號和單上不同 → 擋下「請退回更正」", () => {
    expect(
      matchReceiveScan(lines, new Set(), "5164-1-056528-100-0-6", codeOf),
    ).toEqual({ kind: "last_ticket_mismatch", row: lines[1] });
  });

  it("已點收的列再刷 → 已點收", () => {
    expect(
      matchReceiveScan(lines, new Set(["r1"]), "0056527100", codeOf),
    ).toEqual({ kind: "already_received", row: lines[0] });
  });

  it("單上沒有這本 → not_on_purchase(再查是不是送錯分店)", () => {
    expect(matchReceiveScan(lines, new Set(), "0099999100", codeOf)).toEqual({
      kind: "not_on_purchase",
      bookNo: "0099999",
      gameCode: null,
    });
    expect(
      matchReceiveScan(lines, new Set(), "5201-1-056527-100-0-6", codeOf),
    ).toEqual({ kind: "not_on_purchase", bookNo: "0056527", gameCode: "5201" });
  });

  it("看不懂的碼 → invalid", () => {
    expect(matchReceiveScan(lines, new Set(), "abc", codeOf)).toEqual({
      kind: "invalid",
    });
  });
});

describe("點收進度與「這一次」(規格 8.2 情境表)", () => {
  const lines = Array.from({ length: 10 }, (_, index) =>
    line(`r${String(index + 1)}`, {
      bookNo: `00565${String(20 + index)}`,
    }),
  );

  it("10 本刷完 8 本後完成這次點收:這次 8 本、尚未到 2 本", () => {
    const received = new Set(lines.slice(0, 8).map((item) => item.rowId));
    const summary = receivingSummaryOf(lines, received, received);
    expect(summary.thisTime).toHaveLength(8);
    expect(summary.notArrived.map((item) => item.rowId)).toEqual(["r9", "r10"]);
    expect(summary.receivedCount).toBe(8);
    expect(summary.totalCount).toBe(10);
  });

  it("隔天刷到剩下 2 本:這次只列 2 本、尚未到 = 無", () => {
    const all = new Set(lines.map((item) => item.rowId));
    const summary = receivingSummaryOf(lines, all, new Set(["r9", "r10"]));
    expect(summary.thisTime.map((item) => item.rowId)).toEqual(["r9", "r10"]);
    expect(summary.notArrived).toEqual([]);
  });
});
