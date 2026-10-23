import { describe, expect, it } from "@jest/globals";

import {
  completeSlots,
  dayOffBandOf,
  dayOffCountTone,
  isPastDayOffMonth,
  shiftMonth,
  shortDate,
} from "./schedule-day-offs";

describe("畫休畫面的換算", () => {
  it.each([
    [1, 2, "grey"],
    [2, 2, "warning"],
    [3, 2, "error"],
    [5, null, "grey"],
  ] as const)(
    "同日畫休 %i/%s → %s(未滿灰、滿了橘、超過紅)",
    (count, limit, tone) => {
      expect(dayOffCountTone(count, limit)).toBe(tone);
    },
  );

  it("色帶取那天最嚴重的等級", () => {
    const violations = [
      { key: "a", level: "reminder", dates: ["2026-12-13", "2026-12-14"] },
      { key: "b", level: "limit", dates: ["2026-12-14"] },
    ];
    expect(dayOffBandOf(violations, "2026-12-13")).toBe("reminder");
    expect(dayOffBandOf(violations, "2026-12-14")).toBe("limit");
    expect(dayOffBandOf(violations, "2026-12-15")).toBeNull();
  });

  it("時段:全空的段略過;填一半或開始不早於結束 → null", () => {
    expect(
      completeSlots([
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "", endTime: "" },
      ]),
    ).toEqual([{ startTime: "09:00", endTime: "12:00" }]);
    expect(completeSlots([{ startTime: "09:00", endTime: "" }])).toBeNull();
    expect(
      completeSlots([{ startTime: "13:00", endTime: "09:00" }]),
    ).toBeNull();
    expect(completeSlots([{ startTime: "", endTime: "" }])).toBeNull();
  });

  it("日期與月份", () => {
    expect(shortDate("2026-12-03")).toBe("12/3");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });

  it.each([
    ["2026-12", false], // 目標月
    ["2026-11", false], // 這個月
    ["2026-10", true], // 上個月
    ["2025-03", true], // 更早
  ] as const)("目標月 2026-12:%s → 過去的月份 %s", (month, past) => {
    expect(isPastDayOffMonth(month, "2026-12")).toBe(past);
  });

  it("跨年:目標月 2027-01 的這個月是 2026-12,2026-11 才算過去", () => {
    expect(isPastDayOffMonth("2026-12", "2027-01")).toBe(false);
    expect(isPastDayOffMonth("2026-11", "2027-01")).toBe(true);
  });
});
