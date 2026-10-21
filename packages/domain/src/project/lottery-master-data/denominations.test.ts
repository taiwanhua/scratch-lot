import { describe, expect, it } from "@jest/globals";

import {
  STANDARD_UNIT_PRICES,
  isStandardCombination,
  standardTicketsPerBook,
} from "./denominations";
import { GAME_CODE_PATTERN, bookPriceOf } from "./games";

describe("面額 / 整本張數對照表(規格 5.1)", () => {
  it.each([
    [100, 100],
    [200, 100],
    [300, 100],
    [500, 50],
    [1000, 25],
    [2000, 18],
  ])("面額 %i → 帶入 %i 張,且是標準組合", (unitPrice, tickets) => {
    expect(standardTicketsPerBook(unitPrice)).toBe(tickets);
    expect(isStandardCombination(unitPrice, tickets)).toBe(true);
  });

  it("非標準組合:自填面額不帶入、改過張數的組合只算非標準", () => {
    expect(standardTicketsPerBook(150)).toBeNull();
    expect(isStandardCombination(150, 100)).toBe(false);
    expect(isStandardCombination(500, 100)).toBe(false);
  });

  it("預設面額的順序就是下拉的順序", () => {
    expect(STANDARD_UNIT_PRICES).toEqual([100, 200, 300, 500, 1000, 2000]);
  });

  it("遊戲代號只收 4 碼數字", () => {
    expect(GAME_CODE_PATTERN.test("5201")).toBe(true);
    expect(GAME_CODE_PATTERN.test("520")).toBe(false);
    expect(GAME_CODE_PATTERN.test("52011")).toBe(false);
    expect(GAME_CODE_PATTERN.test("52a1")).toBe(false);
  });

  it("整本金額 = 單張金額 × 張數", () => {
    expect(bookPriceOf(200, 100)).toBe(20_000);
    expect(bookPriceOf(2000, 18)).toBe(36_000);
  });
});
