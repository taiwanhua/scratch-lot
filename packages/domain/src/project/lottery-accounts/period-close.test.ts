import { describe, expect, it } from "@jest/globals";

import {
  addPeriodMonths,
  isPeriodEnded,
  nextClosableMonth,
  periodMonthOf,
  periodMonthsOf,
  periodRangeOf,
} from ".";

const TZ = "Asia/Taipei";
const at = (iso: string) => new Date(iso).getTime();

describe("關帳的月份(規格 10.4)", () => {
  it("月份文字與加減", () => {
    expect(() => addPeriodMonths("2026-13", 1)).toThrow(RangeError);
    expect(() => addPeriodMonths("2026-1", 1)).toThrow(RangeError);
    expect(addPeriodMonths("2026-01", -1)).toBe("2025-12");
    expect(addPeriodMonths("2026-12", 1)).toBe("2027-01");
  });

  it("永遠關到該月最後一刻:10/31 23:59:59.999 算 10 月、11/1 00:00 算 11 月(租戶時區)", () => {
    const { start, end } = periodRangeOf("2026-10", TZ);
    expect(start).toBe(at("2026-10-01T00:00:00+08:00"));
    expect(end).toBe(at("2026-11-01T00:00:00+08:00"));
    const last = at("2026-10-31T23:59:59.999+08:00");
    expect(last < end).toBe(true);
    expect(periodMonthOf(last, TZ)).toBe("2026-10");
    expect(periodMonthOf(at("2026-11-01T00:00:00+08:00"), TZ)).toBe("2026-11");
    // UTC 還在 10/31,台北已是 11/1
    expect(periodMonthOf(at("2026-10-31T16:30:00Z"), TZ)).toBe("2026-11");
  });

  it("只能關已結束的月份:本月沒結束", () => {
    const now = at("2026-11-03T09:00:00+08:00");
    expect(isPeriodEnded("2026-10", now, TZ)).toBe(true);
    expect(isPeriodEnded("2026-11", now, TZ)).toBe(false);
  });

  it("依序關帳:下一個要關的是最後已關帳月份的下一個;沒關過從起始月份;還沒結束 → null", () => {
    const now = at("2026-11-03T09:00:00+08:00");
    expect(
      nextClosableMonth({
        lastClosed: "2026-08",
        firstMonth: "2026-01",
        now,
        timezone: TZ,
      }),
    ).toBe("2026-09");
    expect(
      nextClosableMonth({
        lastClosed: null,
        firstMonth: "2026-09",
        now,
        timezone: TZ,
      }),
    ).toBe("2026-09");
    expect(
      nextClosableMonth({
        lastClosed: "2026-10",
        firstMonth: "2026-01",
        now,
        timezone: TZ,
      }),
    ).toBeNull();
  });

  it("月份列表:新的在前;本月進行中、已結束未關、已關帳", () => {
    expect(
      periodMonthsOf({
        firstMonth: "2026-08",
        closed: ["2026-08"],
        now: at("2026-10-15T12:00:00+08:00"),
        timezone: TZ,
      }),
    ).toEqual([
      { month: "2026-10", status: "current" },
      { month: "2026-09", status: "open" },
      { month: "2026-08", status: "closed" },
    ]);
  });
});
