import { describe, expect, it } from "@jest/globals";

import {
  purchasePayableOf,
  purchaseRedemptionRemainderOf,
  purchaseRedemptionsOf,
} from "./purchase";
import {
  type RedemptionCashRow,
  purchaseRedemptionTotalsOf,
  redemptionDrawerNetOf,
  redemptionPostCloseNetOf,
  redemptionRevokeStateOf,
  redemptionSerialQueryOf,
} from "./redemption";

const open = {
  status: "in_store",
  isMine: true,
  shiftOpen: true,
  canRedeem: true,
  canUndoRedeem: false,
} as const;

describe("撤銷兌獎兩層(規格 6.5)", () => {
  it("自己登記、班開著、有 store.redeem → 自己撤銷", () => {
    expect(redemptionRevokeStateOf(open)).toEqual({
      mode: "self",
      blockedBySent: false,
    });
  });

  it("班已結帳或別人登記 → 要 store.undo-redeem;沒有 → 看不到按鈕", () => {
    expect(
      redemptionRevokeStateOf({ ...open, shiftOpen: false }).mode,
    ).toBeNull();
    expect(
      redemptionRevokeStateOf({ ...open, isMine: false, canUndoRedeem: true })
        .mode,
    ).toBe("manager");
    expect(
      redemptionRevokeStateOf({
        ...open,
        shiftOpen: false,
        canUndoRedeem: true,
      }).mode,
    ).toBe("manager");
  });

  it("已送兌 → 按鈕停用;已撤銷 → 沒有按鈕", () => {
    expect(redemptionRevokeStateOf({ ...open, status: "sent" })).toEqual({
      mode: "self",
      blockedBySent: true,
    });
    expect(
      redemptionRevokeStateOf({ ...open, status: "revoked" }).mode,
    ).toBeNull();
  });
});

const row = (overrides: Partial<RedemptionCashRow>): RedemptionCashRow => ({
  shiftId: "s1",
  prizeAmount: 500,
  revoked: false,
  postCloseOf: null,
  revokePostCloseOf: null,
  ...overrides,
});

describe("抽屜應有與事後更正(規格 6.12、第 17 章第 4、5 題)", () => {
  it("第 4 題:登記 500 → −500;班開著時撤銷 → 0;重登 → −500", () => {
    expect(redemptionDrawerNetOf([row({})], "s1")).toBe(-500);
    expect(redemptionDrawerNetOf([row({ revoked: true })], "s1")).toBe(0);
    expect(redemptionDrawerNetOf([row({ revoked: true }), row({})], "s1")).toBe(
      -500,
    );
  });

  it("第 5 題:交班後撤銷 2,000、重新登記 200 → 結帳時的應有不變,事後更正 +1,800", () => {
    const rows = [
      row({ prizeAmount: 2000, revoked: true, revokePostCloseOf: "s1" }),
      row({ prizeAmount: 200, postCloseOf: "s1" }),
    ];
    expect(redemptionDrawerNetOf(rows, "s1")).toBe(-2000);
    expect(redemptionPostCloseNetOf(rows, "s1")).toBe(1800);
    expect(redemptionPostCloseNetOf(rows, "s2")).toBe(0);
  });
});

describe("進貨單的兌獎合計(規格 8.2)", () => {
  it("批購 60,000、兌獎 100,000 → 折抵 60,000、扣款 0、兌獎剩餘 40,000", () => {
    expect(purchaseRedemptionTotalsOf(60_000, 100_000)).toEqual({
      redemptionTotal: 100_000,
      offset: 60_000,
      deducted: 0,
      remainder: 40_000,
    });
  });

  it("兌獎比批購少 → 全部折抵、沒有剩餘", () => {
    expect(purchaseRedemptionTotalsOf(78_200, 8000)).toEqual({
      redemptionTotal: 8000,
      offset: 8000,
      deducted: 70_200,
      remainder: 0,
    });
  });

  it("勾選的兌獎紀錄:引用值取 id、重複只算一次", () => {
    expect(
      purchaseRedemptionsOf({
        redemptions: [
          {
            rowId: "r1",
            redemption: { id: "a", label: "x" },
            prize_amount: 500,
          },
          { rowId: "r2", redemption: "a", prize_amount: 500 },
          { rowId: "r3", redemption: null },
        ],
      }),
    ).toEqual([{ rowId: "r1", redemptionId: "a", prizeAmount: 500 }]);
  });
});

describe("計算欄存成十進位字串(表單引擎)", () => {
  it("扣款金額、兌獎剩餘讀得到字串", () => {
    expect(purchasePayableOf({ deducted_amount: "0", lines: [] })).toBe(0);
    expect(
      purchaseRedemptionRemainderOf({ redemption_remainder: "40000" }),
    ).toBe(40_000);
  });
});

describe("redemptionSerialQueryOf(兌獎紀錄分頁的單號搜尋)", () => {
  it.each([
    ["RD-0218", "RD-0218"],
    ["rd-0218", "RD-0218"],
    ["RD0218", "RD-0218"],
    ["0218", "RD-0218"],
    ["218", "RD-0218"],
    ["  218  ", "RD-0218"],
    ["12345", "RD-12345"],
  ])("%s → %s", (text, expected) => {
    expect(redemptionSerialQueryOf(text)).toBe(expected);
  });

  it("空白 → null(不篩);看不懂的 → 空字串(找不到任何一筆)", () => {
    expect(redemptionSerialQueryOf("")).toBeNull();
    expect(redemptionSerialQueryOf(" 	 ")).toBeNull();
    expect(redemptionSerialQueryOf(null)).toBeNull();
    expect(redemptionSerialQueryOf("P-0034")).toBe("");
    expect(redemptionSerialQueryOf("abc")).toBe("");
  });
});
