import { describe, expect, it } from "@jest/globals";

import { type CardTicket, cellTooltipOf } from "./card-cells";

const ticket = (overrides: Partial<CardTicket> = {}): CardTicket => ({
  __typename: "LotteryStoreCardTicket",
  id: "t-1",
  ticketNo: "001",
  version: 1,
  status: "unsold",
  locationKind: "counter",
  cashPoint: { __typename: "LotteryAccountsRef", id: "cp-1", name: "店內櫃台" },
  soldShiftId: null,
  soldSource: null,
  locked: false,
  unmatched: false,
  ...overrides,
});

describe("看板格子的提示", () => {
  it("期初已售 → 「導入前已賣出」(樣式照已售;期初建檔規格 D9)", () => {
    expect(
      cellTooltipOf(ticket({ status: "sold", soldSource: "opening" }), "sold"),
    ).toEqual({ key: "expand.openingSold" });
    expect(
      cellTooltipOf(ticket({ status: "sold", soldSource: "scan" }), "sold"),
    ).toBeNull();
  });

  it("別的收銀點 / 庫存寫在哪", () => {
    expect(cellTooltipOf(ticket(), "otherCashPoint")).toEqual({
      key: "expand.atCashPoint",
      values: { name: "店內櫃台" },
    });
    expect(
      cellTooltipOf(ticket({ cashPoint: null }), "otherCashPoint"),
    ).toEqual({ key: "expand.inStock" });
    expect(cellTooltipOf(ticket(), "unsold")).toBeNull();
  });
});
