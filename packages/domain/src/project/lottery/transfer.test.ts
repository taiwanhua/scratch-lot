import { describe, expect, it } from "@jest/globals";

import type { SettlementSideTotals } from "../lottery-accounts/settlement";
import {
  TRANSFER_FIELD_KEYS as K,
  matchTransferScan,
  parseTicketNos,
  receivedTransferAmountOf,
  ticketNosText,
  transferHeaderOf,
  transferLineAmountOf,
  transferLinesOf,
  transferReceiverDefault,
  transferScanOf,
  transferSettlementProblemOf,
  transferShipperDefault,
  transferTotalOf,
  transferUnitCostOf,
} from "./transfer";

function row(
  rowId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rowId,
    [K.game]: { id: "g1", label: "發大財" },
    [K.book]: { id: `b-${rowId}`, label: "5164-056527" },
    [K.mode]: "whole",
    [K.ticketNos]: "001-100",
    [K.tickets]: 100,
    [K.amount]: 2000,
    [K.rate]: 100,
    ...overrides,
  };
}

/** 收付合計:付款方 `out` = 付出去、`in` = 收回來;收款方 `in` = 收進來、`out` = 退出去。 */
const totals = (out: number, inbound: number): SettlementSideTotals => ({
  out,
  in: inbound,
});

/** 分次付款例:A [收款] 的先填值(調貨金額 8,000)。 */
const collect = (receiver: number, shipper: number) =>
  transferShipperDefault("in", 8000, totals(receiver, 0), totals(0, shipper));

describe("調貨單(規格 8.4)", () => {
  it("張號區段:解析與存值格式互換;看不懂 → null", () => {
    expect(parseTicketNos("012-016,020")).toEqual([
      "012",
      "013",
      "014",
      "015",
      "016",
      "020",
    ]);
    expect(parseTicketNos("#012–014、#020")).toEqual([
      "012",
      "013",
      "014",
      "020",
    ]);
    expect(parseTicketNos("abc")).toBeNull();
    expect(parseTicketNos("0")).toBeNull();
    expect(parseTicketNos("016-012")).toBeNull();
    expect(ticketNosText(["020", "012", "013", "014"])).toBe("012-014,020");
    expect(ticketNosText([])).toBe("");
  });

  it("明細列:整本不讀張號;選張解析張號;批購金額一律重算(四捨五入)", () => {
    const lines = transferLinesOf({
      [K.lines]: [
        row("r1"),
        row("r2", {
          [K.mode]: "partial",
          [K.ticketNos]: "012-016,020",
          [K.tickets]: 6,
          [K.amount]: 1200,
          [K.rate]: 92,
          [K.purchaseAmount]: 1,
        }),
        { rowId: "r3" },
      ],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      mode: "whole",
      ticketNos: [],
      purchaseAmount: 2000,
    });
    expect(lines[1]).toMatchObject({
      mode: "partial",
      bookId: "b-r2",
      gameId: "g1",
      ticketNos: ["012", "013", "014", "015", "016", "020"],
      purchaseAmount: 1104,
    });
    expect(transferTotalOf(lines)).toBe(3104);
    expect(receivedTransferAmountOf(lines, new Set(["r2"]))).toBe(1104);
    const partial = lines[1];
    expect(partial && transferUnitCostOf(partial)).toBe(184);
  });

  it("金額:整本 = 整本金額;選張 = 面額 × 張數", () => {
    const game = { bookPrice: 20_000, unitPrice: 200 };
    expect(transferLineAmountOf("whole", game, 100)).toBe(20_000);
    expect(transferLineAmountOf("partial", game, 6)).toBe(1200);
  });

  it("單頭:出貨分店、收貨分店、叫貨單單號", () => {
    expect(
      transferHeaderOf({
        [K.fromBranch]: { id: "A", label: "中山店" },
        [K.toBranch]: "B",
        [K.requisition]: " R-0022 ",
      }),
    ).toEqual({ fromBranchId: "A", toBranchId: "B", requisitionNo: "R-0022" });
  });

  it("點收刷到的碼:本號 + 張號(背面編號帶遊戲代號)", () => {
    expect(transferScanOf("5164-1-056527-099-0-6")).toEqual({
      gameCode: "5164",
      bookNo: "0056527",
      ticketNo: "099",
    });
    expect(transferScanOf("0056527099")).toEqual({
      gameCode: null,
      bookNo: "0056527",
      ticketNo: "099",
    });
    expect(transferScanOf("x")).toBeNull();
  });

  describe("點收刷到的碼對到哪一列", () => {
    const books = new Map([
      ["b1", { gameId: "g1", gameCode: "5164", bookNo: "0056527" }],
      ["b2", { gameId: "g2", gameCode: "5201", bookNo: "0056527" }],
      ["b3", { gameId: "g1", gameCode: "5164", bookNo: "0060116" }],
    ]);
    const lines = [
      { rowId: "r1", bookId: "b1", mode: "whole" as const, ticketNos: [] },
      { rowId: "r2", bookId: "b2", mode: "whole" as const, ticketNos: [] },
      {
        rowId: "r3",
        bookId: "b3",
        mode: "partial" as const,
        ticketNos: ["045", "046"],
      },
    ];
    const bookOf = (bookId: string) => books.get(bookId);
    const scan = (raw: string) => {
      const parsed = transferScanOf(raw);
      if (parsed === null) {
        throw new Error("bad code");
      }
      return parsed;
    };

    it("正面的碼對到多款遊戲同本號、沒選遊戲 → 擋下", () => {
      expect(matchTransferScan(lines, bookOf, scan("0056527099"))).toEqual({
        kind: "ambiguous_game",
        gameIds: ["g1", "g2"],
      });
    });

    it("選了遊戲 / 背面編號 → 對到那款遊戲的列", () => {
      expect(
        matchTransferScan(lines, bookOf, scan("0056527099"), "g2"),
      ).toEqual({ kind: "match", line: lines[1] });
      expect(
        matchTransferScan(lines, bookOf, scan("5164-1-056527-099-0-6")),
      ).toEqual({ kind: "match", line: lines[0] });
    });

    it("選張的列要刷到選的張;單上沒有這本 → not_on_transfer", () => {
      expect(matchTransferScan(lines, bookOf, scan("0060116045"))).toEqual({
        kind: "match",
        line: lines[2],
      });
      expect(matchTransferScan(lines, bookOf, scan("0060116047"))).toEqual({
        kind: "ticket_not_on_transfer",
      });
      expect(matchTransferScan(lines, bookOf, scan("0099999001"))).toEqual({
        kind: "not_on_transfer",
      });
    });
  });

  /**
   * 規格第 9 章調貨單例:5 本 × 2,000 = 10,000;A 店出貨、B 店收貨。每一步驗三個數字(調貨金額、
   * 收貨店已付、出貨店已收)與四顆按鈕的先填值(0 = 停用)。
   */
  describe("收付:規格第 9 章調貨單 5 步驟例", () => {
    const amount = 8000;
    const defaultsOf = (
      received: number,
      receiver: SettlementSideTotals,
      shipper: SettlementSideTotals,
    ) => ({
      pay: transferReceiverDefault("out", received, receiver),
      refundIn: transferReceiverDefault("in", received, receiver),
      collect: transferShipperDefault("in", amount, receiver, shipper),
      refundOut: transferShipperDefault("out", amount, receiver, shipper),
    });

    it("1. B 店點收 4 本、刪掉遺失的第 5 本 → 調貨金額 8,000;B [付款] 8,000", () => {
      expect(defaultsOf(8000, totals(0, 0), totals(0, 0))).toEqual({
        pay: 8000,
        refundIn: 0,
        collect: 0,
        refundOut: 0,
      });
    });

    it("2. B 店付現 10,000 → A [收款] 10,000;B [收到退款] 2,000", () => {
      expect(defaultsOf(8000, totals(10_000, 0), totals(0, 0))).toEqual({
        pay: 0,
        refundIn: 2000,
        collect: 10_000,
        refundOut: 0,
      });
    });

    it("3. A 店收款 10,000 → A [退款] 2,000", () => {
      expect(defaultsOf(8000, totals(10_000, 0), totals(0, 10_000))).toEqual({
        pay: 0,
        refundIn: 2000,
        collect: 0,
        refundOut: 2000,
      });
    });

    it("4. A 店退款 2,000 → B [收到退款] 2,000;A 已收 8,000 = 調貨金額,A 兩顆都停用", () => {
      expect(defaultsOf(8000, totals(10_000, 0), totals(2000, 10_000))).toEqual(
        { pay: 0, refundIn: 2000, collect: 0, refundOut: 0 },
      );
    });

    it("5. B 店收到退款 2,000 → 全部停用;三個數字相等,可以核准", () => {
      const receiver = totals(10_000, 2000);
      const shipper = totals(2000, 10_000);
      expect(defaultsOf(8000, receiver, shipper)).toEqual({
        pay: 0,
        refundIn: 0,
        collect: 0,
        refundOut: 0,
      });
      expect(transferSettlementProblemOf(amount, receiver, shipper)).toBeNull();
    });
  });

  describe("收付:分次付款例(調貨金額 8,000,全部點收)", () => {
    it("B 先付 6,000 → A [收款] 6,000;A 收 6,000 → 停用", () => {
      expect(collect(6000, 0)).toBe(6000);
      expect(collect(6000, 6000)).toBe(0);
    });

    it("B 再付 2,000 → A [收款] 2,000;A 收 2,000 → 停用(已收 = 調貨金額)", () => {
      expect(collect(8000, 6000)).toBe(2000);
      expect(collect(8000, 8000)).toBe(0);
    });
  });

  it("核准前三個數字不相等 → 依序提示哪一邊", () => {
    expect(
      transferSettlementProblemOf(8000, totals(0, 0), totals(0, 0)),
    ).toEqual({ kind: "receiver_underpaid", amount: 8000 });
    expect(
      transferSettlementProblemOf(8000, totals(10_000, 0), totals(0, 0)),
    ).toEqual({ kind: "shipper_unreceived", amount: 8000 });
    expect(
      transferSettlementProblemOf(8000, totals(10_000, 0), totals(0, 10_000)),
    ).toEqual({ kind: "shipper_overreceived", amount: 2000 });
    expect(
      transferSettlementProblemOf(
        8000,
        totals(10_000, 0),
        totals(2000, 10_000),
      ),
    ).toEqual({ kind: "receiver_overpaid", amount: 2000 });
  });
});
