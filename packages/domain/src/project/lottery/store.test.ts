import { describe, expect, it } from "@jest/globals";

import { boardRemainingOf, isLowStock, openingFloatPlanOf } from "./store";

describe("期初零用金(規格 6.6)", () => {
  it("沒有上一班 → 第一班", () => {
    expect(openingFloatPlanOf(null)).toEqual({ kind: "first" });
  });

  it("上一班已被日結涵蓋計算 → 第一班", () => {
    expect(
      openingFloatPlanOf({
        closed: true,
        coveredByDailyClose: true,
        leftForNext: 2000,
      }),
    ).toEqual({ kind: "first" });
  });

  it("上一班已交班、留給下一班 2,000、還沒日結 → 期初 2,000", () => {
    expect(
      openingFloatPlanOf({
        closed: true,
        coveredByDailyClose: false,
        leftForNext: 2000,
      }),
    ).toEqual({ kind: "handover", amount: 2000 });
  });

  it("上一班沒有接班人、留給下一班 0 → 期初 0(不是第一班)", () => {
    expect(
      openingFloatPlanOf({
        closed: true,
        coveredByDailyClose: false,
        leftForNext: 0,
      }),
    ).toEqual({ kind: "handover", amount: 0 });
  });
});

describe("剩很少(看板卡片)", () => {
  it("剩餘 ≤ 總張數 10% 才提示;售完、總數 0 不提示", () => {
    expect(isLowStock(6, 100)).toBe(true);
    expect(isLowStock(10, 100)).toBe(true);
    expect(isLowStock(11, 100)).toBe(false);
    expect(isLowStock(10, 25)).toBe(false);
    expect(isLowStock(0, 100)).toBe(false);
    expect(isLowStock(0, 0)).toBe(false);
  });
});

describe("看板卡片剩餘扣待標註(張數店規格 14.2;使用者 11/04 定)", () => {
  it.each([
    ["全在這一台 → 扣待標註", 30, 2, 1, 28],
    ["分在兩台 → 不扣", 30, 2, 2, 30],
    ["沒有待標註 → 照舊", 30, 0, 1, 30],
    ["扣完不會小於 0", 1, 2, 1, 0],
  ])("%s", (_, remaining, pending, counters, expected) => {
    expect(boardRemainingOf(remaining, pending, counters)).toBe(expected);
  });
});
