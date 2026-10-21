import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_SCHEDULE_ROSTER_STAT_COLUMNS,
  defaultBreakMinutes,
  formatWorkMinutes,
  leaderCoverageGaps,
  pickOpenTask,
  rosterStatColumnsOf,
  rosterStatColumnsValue,
} from "./index";

const TIERS = [
  { minMinutes: 480, breakMinutes: 60 },
  { minMinutes: 240, breakMinutes: 30 },
];

describe("預設休息(規則「預設休息」)", () => {
  it.each([
    [180, 0],
    [240, 30],
    [450, 30],
    [480, 60],
    [600, 60],
  ])("排班 %i 分鐘 → 休息 %i 分鐘", (duration, expected) => {
    expect(defaultBreakMinutes(TIERS, duration)).toBe(expected);
  });

  it("沒有任何級距 → 0", () => {
    expect(defaultBreakMinutes([], 600)).toBe(0);
  });
});

const task = (taskId: string, role: string, filled = false) => ({
  taskId,
  role,
  filled,
});

describe("選人力需求自動填第一個空的執行任務(規格 14.5 排班對話框)", () => {
  it.each([
    {
      case: "還缺負責、可以擔任負責人 → 負責",
      tasks: [task("h1", "helper"), task("l1", "leader")],
      canLead: true,
      expected: "l1",
    },
    {
      case: "還缺負責、不能擔任負責人 → 第一個空的協同",
      tasks: [task("l1", "leader"), task("h1", "helper"), task("h2", "helper")],
      canLead: false,
      expected: "h1",
    },
    {
      case: "負責已有人 → 第一個空的協同",
      tasks: [
        task("l1", "leader", true),
        task("h1", "helper", true),
        task("h2", "helper"),
      ],
      canLead: true,
      expected: "h2",
    },
    {
      case: "沒有負責任務 → 協同",
      tasks: [task("h1", "helper")],
      canLead: true,
      expected: "h1",
    },
    {
      case: "全部滿了 → null",
      tasks: [task("l1", "leader", true), task("h1", "helper", true)],
      canLead: true,
      expected: null,
    },
    {
      case: "只剩負責、不能擔任 → null",
      tasks: [task("l1", "leader"), task("h1", "helper", true)],
      canLead: false,
      expected: null,
    },
  ])("$case", ({ tasks, canLead, expected }) => {
    expect(pickOpenTask(tasks, canLead)).toBe(expected);
  });
});

const at = (hhmm: string) => Date.parse(`2026-11-04T${hhmm}:00+08:00`);

describe("負責人上下班時間涵蓋(規格 14.5「時間涵蓋提示」)", () => {
  const demand = { startAt: at("14:30"), endAt: at("22:00") };

  it.each([
    {
      case: "完全涵蓋 → 不提示",
      entry: { startAt: at("14:00"), endAt: at("22:00") },
      gaps: { extendStartTo: null, extendEndTo: null },
    },
    {
      case: "下班太早 → 往後延長到 22:00",
      entry: { startAt: at("14:30"), endAt: at("18:00") },
      gaps: { extendStartTo: null, extendEndTo: at("22:00") },
    },
    {
      case: "上班太晚 → 往前延長到 14:30",
      entry: { startAt: at("16:00"), endAt: at("22:00") },
      gaps: { extendStartTo: at("14:30"), extendEndTo: null },
    },
    {
      case: "兩端都缺 → 兩顆",
      entry: { startAt: at("16:00"), endAt: at("20:00") },
      gaps: { extendStartTo: at("14:30"), extendEndTo: at("22:00") },
    },
  ])("$case", ({ entry, gaps }) => {
    expect(leaderCoverageGaps(entry, demand)).toEqual(gaps);
  });
});

describe("統計欄", () => {
  it.each([
    [9150, "152:30"],
    [0, "0:00"],
    [65, "1:05"],
  ])("總工時 %i 分 → %s", (minutes, text) => {
    expect(formatWorkMinutes(minutes)).toBe(text);
  });

  it("[⚙ 顯示欄位] 的偏好值:依固定順序、不合格式用預設", () => {
    expect(rosterStatColumnsOf("longestStreak,shiftCount")).toEqual([
      "shiftCount",
      "longestStreak",
    ]);
    expect(rosterStatColumnsOf("")).toEqual([]);
    expect(rosterStatColumnsOf(null)).toEqual(
      DEFAULT_SCHEDULE_ROSTER_STAT_COLUMNS,
    );
    expect(rosterStatColumnsOf("bogus")).toEqual(
      DEFAULT_SCHEDULE_ROSTER_STAT_COLUMNS,
    );
    expect(rosterStatColumnsValue(["workMinutes", "shiftCount"])).toBe(
      "shiftCount,workMinutes",
    );
  });
});
