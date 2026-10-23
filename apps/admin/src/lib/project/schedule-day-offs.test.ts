import { describe, expect, it } from "@jest/globals";

import {
  completeSlots,
  dayKeyOf,
  dayOffBandOf,
  dayOffCountTone,
  isPastDayOffMonth,
  monthRangeOf,
  slotInstantsOf,
} from "./schedule-day-offs";

const TAIPEI = "Asia/Taipei";
const taipei = (date: string, time = "00:00") =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

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

  it("色帶取那天最嚴重的等級(違反的日期是時點,以租戶時區的日期對格子)", () => {
    const violations = [
      {
        key: "a",
        level: "reminder",
        dates: [taipei("2026-12-13"), taipei("2026-12-14")],
      },
      { key: "b", level: "limit", dates: [taipei("2026-12-14")] },
    ];
    expect(dayOffBandOf(violations, "2026-12-13", TAIPEI)).toBe("reminder");
    expect(dayOffBandOf(violations, "2026-12-14", TAIPEI)).toBe("limit");
    expect(dayOffBandOf(violations, "2026-12-15", TAIPEI)).toBeNull();
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

  it("時點 ↔ 日期鍵、月份的時點區間(租戶時區不是台北時也對)", () => {
    // 台北 12/3 00:00 = UTC 12/2 16:00
    expect(dayKeyOf(taipei("2026-12-03"), TAIPEI)).toBe("2026-12-03");
    expect(dayKeyOf(taipei("2026-12-03"), "UTC")).toBe("2026-12-02");
    expect(dayKeyOf("not-a-date", TAIPEI)).toBe("");
    expect(monthRangeOf("2026-12", TAIPEI)).toEqual({
      from: taipei("2026-12-01"),
      to: taipei("2027-01-01"),
    });
    // 洛杉磯 12 月是 UTC−8
    expect(monthRangeOf("2026-12", "America/Los_Angeles")).toEqual({
      from: "2026-12-01T08:00:00.000Z",
      to: "2027-01-01T08:00:00.000Z",
    });
    expect(monthRangeOf("2026-13", TAIPEI)).toBeNull();
  });

  it("時段:那天的 HH:mm 以租戶時區合成時點;不合法 → null", () => {
    expect(
      slotInstantsOf(
        "2026-12-10",
        [{ startTime: "09:00", endTime: "13:00" }],
        TAIPEI,
      ),
    ).toEqual([
      {
        startAt: taipei("2026-12-10", "09:00"),
        endAt: taipei("2026-12-10", "13:00"),
      },
    ]);
    expect(
      slotInstantsOf(
        "2026-12-10",
        [{ startTime: "09:00", endTime: "13:00" }],
        "America/Los_Angeles",
      ),
    ).toEqual([
      {
        startAt: "2026-12-10T17:00:00.000Z",
        endAt: "2026-12-10T21:00:00.000Z",
      },
    ]);
    expect(
      slotInstantsOf(
        "2026-12-10",
        [{ startTime: "9:00", endTime: "13:00" }],
        TAIPEI,
      ),
    ).toBeNull();
    expect(
      slotInstantsOf("", [{ startTime: "09:00", endTime: "13:00" }], TAIPEI),
    ).toBeNull();
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
