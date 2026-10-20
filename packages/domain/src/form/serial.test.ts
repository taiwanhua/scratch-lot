import { describe, expect, it } from "@jest/globals";

import {
  formatSerial,
  normalizeSerialFormat,
  serialFormatIssues,
  serialPeriodKeyOf,
} from "./serial";

const TAIPEI = "Asia/Taipei";

describe("單號格式(serial)", () => {
  it("依期間組出 前綴-期間-流水號", () => {
    const format = { prefix: "PU", period: "month", digits: 4 } as const;
    expect(formatSerial(format, "202610", 1)).toBe("PU-202610-0001");
    expect(
      formatSerial({ ...format, period: "year", separator: "" }, "2026", 12),
    ).toBe("PU20260012");
    expect(formatSerial({ ...format, period: "none" }, "none", 7)).toBe(
      "PU-0007",
    );
    expect(
      formatSerial({ prefix: "", period: "none", digits: 3 }, "none", 5),
    ).toBe("005");
  });

  it("流水號超過位數不截斷", () => {
    expect(
      formatSerial({ prefix: "A", period: "none", digits: 2 }, "none", 123),
    ).toBe("A-123");
  });

  it("期間用租戶時區切:台北 10/31 23:30(UTC 15:30)已是 11 月 1 日", () => {
    const instant = Date.parse("2026-10-31T16:30:00Z");
    expect(serialPeriodKeyOf("month", instant, TAIPEI)).toBe("202611");
    expect(serialPeriodKeyOf("month", instant, "UTC")).toBe("202610");
    expect(serialPeriodKeyOf("year", instant, TAIPEI)).toBe("2026");
    expect(serialPeriodKeyOf("none", instant, TAIPEI)).toBe("none");
  });

  it("格式檢查:前綴、期間、位數、分隔符", () => {
    expect(
      serialFormatIssues({ prefix: "PU", period: "month", digits: 4 }),
    ).toEqual([]);
    expect(
      serialFormatIssues({ prefix: "P U", period: "week", digits: 0 }).map(
        (issue) => issue.path,
      ),
    ).toEqual(["prefix", "period", "digits"]);
    expect(
      serialFormatIssues({
        prefix: "PU",
        period: "none",
        digits: 4,
        separator: "--",
      }).map((issue) => issue.path),
    ).toEqual(["separator"]);
    expect(serialFormatIssues("PU").map((issue) => issue.path)).toEqual([""]);
  });

  it("正規化:去掉多餘鍵、分隔符缺席 = 不存(預設 -);不合法回 null", () => {
    expect(
      normalizeSerialFormat({
        prefix: "PU",
        period: "month",
        digits: 4,
        extra: 1,
      }),
    ).toEqual({ prefix: "PU", period: "month", digits: 4 });
    expect(
      normalizeSerialFormat({
        prefix: "PU",
        period: "month",
        digits: 4,
        separator: "/",
      }),
    ).toEqual({ prefix: "PU", period: "month", digits: 4, separator: "/" });
    expect(normalizeSerialFormat({ prefix: "PU" })).toBeNull();
  });
});
