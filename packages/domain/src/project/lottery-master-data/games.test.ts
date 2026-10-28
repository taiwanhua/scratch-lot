import { describe, expect, it } from "@jest/globals";

import { localDateText, parseLocalDate } from "../../form/temporal";
import { gameDatesOf, isValidUnitPrice } from "./games";

const datesOf = (claimDeadline: string) => {
  const date = parseLocalDate(claimDeadline);
  if (date === null) {
    throw new Error(`not a date: ${claimDeadline}`);
  }
  const { launchedAt, discontinuedAt } = gameDatesOf(date);
  return [localDateText(launchedAt), localDateText(discontinuedAt)];
};

describe("上市日 / 停售日由兌獎截止日推算(規格 5.1)", () => {
  it.each([
    // 一般:停售 = −3 個月、上市 = −9 個月
    ["2026-12-15", "2026-03-15", "2026-09-15"],
    // 跨年
    ["2026-02-10", "2025-05-10", "2025-11-10"],
    // 月底:目標月份沒有那一天 → 該月最後一天
    ["2026-05-31", "2025-08-31", "2026-02-28"],
    ["2026-12-31", "2026-03-31", "2026-09-30"],
    // 閏年 2/29
    ["2028-05-31", "2027-08-31", "2028-02-29"],
    ["2028-11-30", "2028-02-29", "2028-08-30"],
  ])("兌獎截止 %s → 上市 %s、停售 %s", (deadline, launched, discontinued) => {
    expect(datesOf(deadline)).toEqual([launched, discontinued]);
  });
});

describe("單張金額一定是 100 的倍數(使用者 10/28 定案)", () => {
  it.each([
    [100, true],
    [400, true],
    [2000, true],
    [0, false],
    [-100, false],
    [150, false],
    [99.5, false],
  ])("%d → %s", (unitPrice, valid) => {
    expect(isValidUnitPrice(unitPrice)).toBe(valid);
  });
});
