import { describe, expect, it } from "@jest/globals";

import type { ScheduleRuleLevel } from "@repo/domain/project/schedule-settings";

import type { EffectiveRuleSetting } from "../rules/rule-registry";
import {
  type DayOffLike,
  consecutiveRuns,
  dayOffDates,
  dayOffStaffCounts,
  maxConsecutiveDaysOffEvaluator,
  maxDailyDayOffStaffEvaluator,
  maxMonthlyDayOffsEvaluator,
  minMonthlyDayOffsEvaluator,
} from "./day-off-rules";
import {
  dayOffTargetMonth,
  dayOffWindowDaysLeft,
  dayOffWindowFor,
  dayOffWindowState,
} from "./day-off-window";

const full = (userId: string, date: string): DayOffLike => ({
  userId,
  date,
  kind: "full-day",
});
const range = (userId: string, date: string): DayOffLike => ({
  userId,
  date,
  kind: "time-range",
});

const setting = (
  key: string,
  amount: number,
  level: ScheduleRuleLevel = "limit",
  enabled = true,
): EffectiveRuleSetting => ({
  key,
  enabled,
  value: { amount },
  level,
  order: 1,
});

const context = <TData>(rule: EffectiveRuleSetting, data: TData) => ({
  tenantId: "t",
  orgId: "o",
  setting: rule,
  data,
});

describe("畫休的算法(規格 14.2:那天有任何一種就算 1 天、1 人)", () => {
  it.each([
    {
      label: "A 早上不可排、B 下午不可排 → 那天 2 人畫休",
      dayOffs: [range("A", "2026-12-03"), range("B", "2026-12-03")],
      count: 2,
    },
    {
      label: "同一人同一天整天 + 時段 → 1 人",
      dayOffs: [full("A", "2026-12-03"), range("A", "2026-12-03")],
      count: 1,
    },
    {
      label: "同一人同一天兩段時段不可排 → 1 人",
      dayOffs: [range("A", "2026-12-03"), range("A", "2026-12-03")],
      count: 1,
    },
    {
      label: "A 整天、B 時段 → 2 人",
      dayOffs: [full("A", "2026-12-03"), range("B", "2026-12-03")],
      count: 2,
    },
  ])("同日畫休人數:$label", ({ dayOffs, count }) => {
    expect(dayOffStaffCounts(dayOffs).get("2026-12-03")).toBe(count);
  });

  it.each([
    {
      label: "同一人同一天整天 + 時段 → 算 1 天",
      dayOffs: [full("A", "2026-12-03"), range("A", "2026-12-03")],
      days: ["2026-12-03"],
    },
    {
      label: "時段不可排也算畫休天數",
      dayOffs: [range("A", "2026-12-03"), full("A", "2026-12-05")],
      days: ["2026-12-03", "2026-12-05"],
    },
    {
      label: "別人的不算",
      dayOffs: [full("B", "2026-12-03")],
      days: [],
    },
  ])("畫休天數:$label", ({ dayOffs, days }) => {
    expect(dayOffDates(dayOffs, "A")).toEqual(days);
  });
});

describe("每月最多 / 最少畫休(人)", () => {
  const nine = [
    ...Array.from({ length: 8 }, (_, index) =>
      full("A", `2026-12-${String(index + 1).padStart(2, "0")}`),
    ),
    range("A", "2026-12-20"),
    // 同一天整天 + 時段不再多算
    range("A", "2026-12-01"),
    // 別的月不算
    full("A", "2026-11-30"),
  ];

  it("9 天 > 上限 8 → 違反(時段不可排也算一天)", () => {
    const violations = maxMonthlyDayOffsEvaluator(
      context(setting("maxMonthlyDayOffs", 8), {
        userId: "A",
        month: "2026-12",
        dayOffs: nine,
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        key: "maxMonthlyDayOffs",
        level: "limit",
        detail: { actual: 9, limit: 8 },
      }),
    ]);
  });

  it("上限 9 → 不違反;關掉的規則不檢查", () => {
    const data = { userId: "A", month: "2026-12", dayOffs: nine };
    expect(
      maxMonthlyDayOffsEvaluator(
        context(setting("maxMonthlyDayOffs", 9), data),
      ),
    ).toEqual([]);
    expect(
      maxMonthlyDayOffsEvaluator(
        context(setting("maxMonthlyDayOffs", 1, "limit", false), data),
      ),
    ).toEqual([]);
  });

  it("3 天 < 下限 4 → 違反(等級照設定)", () => {
    const violations = minMonthlyDayOffsEvaluator(
      context(setting("minMonthlyDayOffs", 4, "reminder"), {
        userId: "A",
        month: "2026-12",
        dayOffs: [
          full("A", "2026-12-01"),
          range("A", "2026-12-02"),
          full("A", "2026-12-03"),
        ],
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        level: "reminder",
        detail: { actual: 3, limit: 4 },
      }),
    ]);
  });
});

const evaluateConsecutive = (dayOffs: DayOffLike[], limit = 3) =>
  maxConsecutiveDaysOffEvaluator(
    context(setting("maxConsecutiveDaysOff", limit, "reminder"), {
      userId: "A",
      month: "2026-12",
      dayOffs,
    }),
  );

describe("最多連續休假只算整天畫休", () => {
  it("連續 4 天整天畫休 > 3 → 違反,附起訖", () => {
    const violations = evaluateConsecutive(
      ["2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"].map((date) =>
        full("A", date),
      ),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        key: "maxConsecutiveDaysOff",
        detail: { actual: 4, limit: 3, from: "2026-12-10", to: "2026-12-13" },
      }),
    ]);
  });

  it("中間一天是時段不可排 → 斷開,不違反", () => {
    expect(
      evaluateConsecutive([
        full("A", "2026-12-10"),
        full("A", "2026-12-11"),
        range("A", "2026-12-12"),
        full("A", "2026-12-13"),
      ]),
    ).toEqual([]);
  });

  it("跨月連續也算(11/30–12/03 共 4 天)", () => {
    const violations = evaluateConsecutive(
      ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"].map((date) =>
        full("A", date),
      ),
    );
    expect(violations[0]?.detail).toMatchObject({
      from: "2026-11-30",
      to: "2026-12-03",
    });
  });

  it("連續段的切法", () => {
    expect(
      consecutiveRuns(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-03"]),
    ).toEqual([
      { from: "2026-12-30", to: "2027-01-01", length: 3 },
      { from: "2027-01-03", to: "2027-01-03", length: 1 },
    ]);
  });
});

describe("同日最多畫休人數(店)", () => {
  it("A 早上不可排、B 下午不可排、C 整天 → 3 人 > 2 → 違反,targets 列出那天與三人", () => {
    const violations = maxDailyDayOffStaffEvaluator(
      context(setting("maxDailyDayOffStaff", 2), {
        month: "2026-12",
        dayOffs: [
          range("A", "2026-12-24"),
          range("B", "2026-12-24"),
          full("C", "2026-12-24"),
          full("A", "2026-12-25"),
        ],
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      level: "limit",
      detail: { actual: 3, limit: 2, from: "2026-12-24" },
    });
    expect(violations[0]?.targets).toEqual([
      { date: "2026-12-24" },
      { userId: "A", date: "2026-12-24" },
      { userId: "B", date: "2026-12-24" },
      { userId: "C", date: "2026-12-24" },
    ]);
  });

  it("剛好滿 2/2 → 不違反", () => {
    expect(
      maxDailyDayOffStaffEvaluator(
        context(setting("maxDailyDayOffStaff", 2), {
          month: "2026-12",
          dayOffs: [range("A", "2026-12-24"), full("B", "2026-12-24")],
        }),
      ),
    ).toEqual([]);
  });
});

describe("畫休開放期間(每月 N 日至 M 日,登記下個月)", () => {
  it.each([
    ["2026-12", { startDay: 15, endDay: 25 }, "2026-11-15", "2026-11-25"],
    ["2026-03", { startDay: 25, endDay: 31 }, "2026-02-25", "2026-02-28"],
    ["2028-03", { startDay: 30, endDay: 31 }, "2028-02-29", "2028-02-29"],
    ["2027-01", { startDay: 1, endDay: 10 }, "2026-12-01", "2026-12-10"],
  ])("%s 的開放期間 %j → %s–%s", (month, value, startDate, endDate) => {
    expect(dayOffWindowFor(month, value)).toEqual({
      month,
      startDate,
      endDate,
    });
  });

  it.each([
    ["2026-11-14", "before", 0],
    ["2026-11-15", "open", 11],
    ["2026-11-25", "open", 1],
    ["2026-11-26", "closed", 0],
  ] as const)("今天 %s → %s,剩 %i 天", (today, state, daysLeft) => {
    const window = dayOffWindowFor("2026-12", { startDay: 15, endDay: 25 });
    expect(dayOffWindowState(window, today)).toBe(state);
    expect(dayOffWindowDaysLeft(window, today)).toBe(daysLeft);
  });

  it("今天登記的是下個月(跨年)", () => {
    expect(dayOffTargetMonth("2026-12-20")).toBe("2027-01");
  });
});
