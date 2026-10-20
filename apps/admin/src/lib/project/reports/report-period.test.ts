import { describe, expect, it } from "@jest/globals";

import {
  type ReportPeriodValue,
  lastDayOfWeek,
  normalizePeriod,
  periodStartOf,
  reportPeriodRange,
  shiftPeriod,
  todayOf,
} from "./report-period";

const TAIPEI = "Asia/Taipei";
const UTC = "Etc/UTC";

const range = (value: ReportPeriodValue, timezone: string) =>
  reportPeriodRange(value, timezone);

describe("報表期間 → 起訖時點(迄不含)", () => {
  it.each([
    // [說明, 期間, 時區, 起, 迄]
    [
      "日:台北",
      { kind: "day", date: "2026-10-16" },
      TAIPEI,
      "2026-10-15T16:00:00.000Z",
      "2026-10-16T16:00:00.000Z",
    ],
    [
      "日:UTC+0",
      { kind: "day", date: "2026-10-16" },
      UTC,
      "2026-10-16T00:00:00.000Z",
      "2026-10-17T00:00:00.000Z",
    ],
    [
      "週(點星期三 → 星期日起):台北",
      { kind: "week", date: "2026-10-14" },
      TAIPEI,
      "2026-10-10T16:00:00.000Z",
      "2026-10-17T16:00:00.000Z",
    ],
    [
      "週(點星期三 → 星期日起):UTC+0",
      { kind: "week", date: "2026-10-14" },
      UTC,
      "2026-10-11T00:00:00.000Z",
      "2026-10-18T00:00:00.000Z",
    ],
    [
      "週(點的就是星期日)",
      { kind: "week", date: "2026-10-11" },
      UTC,
      "2026-10-11T00:00:00.000Z",
      "2026-10-18T00:00:00.000Z",
    ],
    [
      "週(點的是星期六)",
      { kind: "week", date: "2026-10-17" },
      UTC,
      "2026-10-11T00:00:00.000Z",
      "2026-10-18T00:00:00.000Z",
    ],
    [
      "跨月週:台北(10/1 星期四 → 9/27 起)",
      { kind: "week", date: "2026-10-01" },
      TAIPEI,
      "2026-09-26T16:00:00.000Z",
      "2026-10-03T16:00:00.000Z",
    ],
    [
      "跨月週:UTC+0",
      { kind: "week", date: "2026-10-01" },
      UTC,
      "2026-09-27T00:00:00.000Z",
      "2026-10-04T00:00:00.000Z",
    ],
    [
      "跨年週(2027/1/1 星期五)",
      { kind: "week", date: "2027-01-01" },
      UTC,
      "2026-12-27T00:00:00.000Z",
      "2027-01-03T00:00:00.000Z",
    ],
    [
      "月:台北",
      { kind: "month", date: "2026-10-16" },
      TAIPEI,
      "2026-09-30T16:00:00.000Z",
      "2026-10-31T16:00:00.000Z",
    ],
    [
      "月:UTC+0",
      { kind: "month", date: "2026-10-16" },
      UTC,
      "2026-10-01T00:00:00.000Z",
      "2026-11-01T00:00:00.000Z",
    ],
    [
      "閏年 2 月(29 天):台北",
      { kind: "month", date: "2028-02-29" },
      TAIPEI,
      "2028-01-31T16:00:00.000Z",
      "2028-02-29T16:00:00.000Z",
    ],
    [
      "閏年 2 月(29 天):UTC+0",
      { kind: "month", date: "2028-02-10" },
      UTC,
      "2028-02-01T00:00:00.000Z",
      "2028-03-01T00:00:00.000Z",
    ],
    [
      "平年 2 月(28 天)",
      { kind: "month", date: "2027-02-10" },
      UTC,
      "2027-02-01T00:00:00.000Z",
      "2027-03-01T00:00:00.000Z",
    ],
    [
      "12 月跨年",
      { kind: "month", date: "2026-12-31" },
      TAIPEI,
      "2026-11-30T16:00:00.000Z",
      "2026-12-31T16:00:00.000Z",
    ],
  ] as const)("%s", (_label, value, timezone, from, to) => {
    expect(range(value, timezone)).toEqual({ from, to });
  });

  it("日期不合法 → null", () => {
    expect(range({ kind: "day", date: "2026-02-30" }, UTC)).toBeNull();
    expect(range({ kind: "day", date: "" }, UTC)).toBeNull();
  });
});

describe("期間的起點與快捷", () => {
  it("periodStartOf:日原樣、週退到星期日、月退到 1 日", () => {
    expect(periodStartOf("day", "2026-10-14")).toBe("2026-10-14");
    expect(periodStartOf("week", "2026-10-14")).toBe("2026-10-11");
    expect(periodStartOf("week", "2026-03-01")).toBe("2026-03-01");
    expect(periodStartOf("month", "2026-10-14")).toBe("2026-10-01");
  });

  it("lastDayOfWeek:星期日 + 6 天 = 星期六(跨月)", () => {
    expect(lastDayOfWeek("2026-10-11")).toBe("2026-10-17");
    expect(lastDayOfWeek("2026-09-27")).toBe("2026-10-03");
  });

  it.each([
    ["昨天", "day", "2026-10-01", -1, "2026-09-30"],
    ["上週(回傳上週的星期日)", "week", "2026-10-14", -1, "2026-10-04"],
    ["上週跨月", "week", "2026-10-01", -1, "2026-09-20"],
    ["上月", "month", "2026-10-16", -1, "2026-09-01"],
    ["上月跨年", "month", "2026-01-31", -1, "2025-12-01"],
    ["上月從 3/31(不溢出到 3 月)", "month", "2026-03-31", -1, "2026-02-01"],
  ] as const)("shiftPeriod:%s", (_label, kind, date, amount, expected) => {
    expect(shiftPeriod(kind, date, amount)).toBe(expected);
  });

  it("todayOf:租戶時區的今天(不是瀏覽器時區)", () => {
    // UTC 10/16 20:00 = 台北 10/17 04:00
    const now = Date.parse("2026-10-16T20:00:00.000Z");
    expect(todayOf(TAIPEI, now)).toBe("2026-10-17");
    expect(todayOf(UTC, now)).toBe("2026-10-16");
  });

  it("normalizePeriod:日期換成該期間的起點;空日期 → 今天所在的期間", () => {
    expect(
      normalizePeriod({ kind: "week", date: "2026-10-14" }, "2026-10-20"),
    ).toEqual({ kind: "week", date: "2026-10-11" });
    expect(normalizePeriod({ kind: "month", date: "" }, "2026-10-20")).toEqual({
      kind: "month",
      date: "2026-10-01",
    });
  });
});
