import { describe, expect, it } from "@jest/globals";

import { rosterStatsOf, workMinutesOf } from "./roster-stats";

const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);

const entry = (
  date: string,
  start: string,
  end: string,
  breakMinutes: number,
  isLead = false,
) => ({
  date,
  startAt: at(date, start),
  endAt: at(date, end),
  breakMinutes,
  isLead,
});

describe("班表檢視統計欄(規格 14.5)", () => {
  it("總工時 = 下班 − 上班 − 休息,到分鐘;跨午夜照實際時間", () => {
    expect(workMinutesOf(entry("2026-11-01", "08:30", "14:30", 30))).toBe(330);
    expect(
      workMinutesOf({
        startAt: at("2026-11-01", "22:00"),
        endAt: at("2026-11-02", "06:00"),
        breakMinutes: 60,
      }),
    ).toBe(420);
  });

  it("負責班數以排班為單位、總工時 152:30 = 9150 分", () => {
    // 25 筆 6 小時(休 0)= 9000 分 + 1 筆 2:30 = 150 分
    const entries = [
      ...Array.from({ length: 25 }, (_, index) =>
        entry(
          `2026-11-${String(index + 1).padStart(2, "0")}`,
          "08:00",
          "14:00",
          0,
          index < 10,
        ),
      ),
      entry("2026-11-26", "14:30", "17:30", 30, true),
    ];
    const stats = rosterStatsOf({
      userId: "u1",
      entries,
      allWorkDates: entries.map((item) => item.date),
      dayOffs: [],
      slots: [],
    });
    expect(stats.shiftCount).toBe(26);
    expect(stats.leadShiftCount).toBe(11);
    expect(stats.workMinutes).toBe(9150);
  });

  it("畫休天數同畫休規則:那天有任何畫休就算 1 天(整天 + 時段同一天算 1 天)", () => {
    const stats = rosterStatsOf({
      userId: "u1",
      entries: [],
      allWorkDates: [],
      dayOffs: [
        { userId: "u1", date: "2026-11-03", kind: "full-day" },
        { userId: "u1", date: "2026-11-05", kind: "time-range" },
        { userId: "u1", date: "2026-11-05", kind: "time-range" },
        { userId: "u1", date: "2026-11-09", kind: "full-day" },
        { userId: "u1", date: "2026-11-09", kind: "time-range" },
        { userId: "u1", date: "2026-11-12", kind: "time-range" },
        { userId: "other", date: "2026-11-20", kind: "full-day" },
      ],
      slots: [
        {
          date: "2026-11-05",
          startAt: at("2026-11-05", "09:00"),
          endAt: at("2026-11-05", "13:00"),
        },
        {
          date: "2026-11-05",
          startAt: at("2026-11-05", "18:00"),
          endAt: at("2026-11-05", "20:00"),
        },
        {
          date: "2026-11-09",
          startAt: at("2026-11-09", "09:00"),
          endAt: at("2026-11-09", "10:00"),
        },
        {
          date: "2026-11-12",
          startAt: at("2026-11-12", "18:00"),
          endAt: at("2026-11-12", "22:00"),
        },
      ],
    });
    expect(stats.dayOffDays).toBe(4);
    expect(stats.fullDayOffDays).toBe(2);
    expect(stats.timeRangeDays).toEqual([
      {
        date: "2026-11-05",
        slots: [
          {
            startAt: at("2026-11-05", "09:00"),
            endAt: at("2026-11-05", "13:00"),
          },
          {
            startAt: at("2026-11-05", "18:00"),
            endAt: at("2026-11-05", "20:00"),
          },
        ],
      },
      {
        date: "2026-11-12",
        slots: [
          {
            startAt: at("2026-11-12", "18:00"),
            endAt: at("2026-11-12", "22:00"),
          },
        ],
      },
    ]);
  });

  it("最長連續上班:任何分店有排班的日子最長連續幾天", () => {
    const stats = rosterStatsOf({
      userId: "u1",
      entries: [],
      allWorkDates: [
        "2026-11-01",
        "2026-11-02",
        "2026-11-02",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
      ],
      dayOffs: [],
      slots: [],
    });
    expect(stats.longestStreak).toBe(3);
    expect(
      rosterStatsOf({
        userId: "u1",
        entries: [],
        allWorkDates: [],
        dayOffs: [],
        slots: [],
      }).longestStreak,
    ).toBe(0);
  });
});
