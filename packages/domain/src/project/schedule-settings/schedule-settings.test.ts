import { describe, expect, it } from "@jest/globals";

import {
  SCHEDULE_RULE_DEFINITIONS,
  exceededTaskRoles,
  isHhMm,
  isIsoDate,
  isIsoMonth,
  isScheduleRuleToggleable,
  isTemplateShortName,
  minutesOfHhMm,
  pickScheduleRuleValue,
  scheduleRuleDefinitionOf,
  scheduleRuleValueErrors,
} from "./index";

function definition(key: string) {
  const found = scheduleRuleDefinitionOf(key);
  if (!found) {
    throw new Error(`沒有規則 ${key}`);
  }
  return found;
}

describe("排班規則定義(規格 14.2)", () => {
  it("規則依規格 14.2 表的順序,自動排班條件另成一組在最後", () => {
    expect(
      SCHEDULE_RULE_DEFINITIONS.map(
        (rule) => `${rule.group}:${rule.key}:${rule.label}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "rule:maxMonthlyDayOffs:每月最多畫休",
        "rule:minMonthlyDayOffs:每月最少畫休",
        "rule:maxConsecutiveWorkDays:最多連續上班",
        "rule:maxConsecutiveDaysOff:最多連續休假",
        "rule:minRestBetweenShifts:兩班之間最少休息",
        "rule:maxDailyWorkHours:每天最多上班時數",
        "rule:dayOffWindow:畫休開放期間",
        "rule:maxDailyDayOffStaff:同日最多畫休人數",
        "rule:understaffed:人力不足",
        "rule:multiPositionOverlap:同一時段兼多個崗位",
        "rule:entryMatchToleranceMinutes:對應排班容許時間",
        "rule:autoDemandWeekTemplateId:預設人力需求週範本",
        "rule:graceMinutes:遲到 / 早退寬限",
        "rule:defaultBreaks:預設休息",
        "rule:defaultTasks:負責人 / 協同預設任務",
        "autoRun:continuePreviousEntry:延續同一人的排班",
        "autoRun:leaderCountFirst:負責人次數多者優先",
        "autoRun:monthlyShiftBalance:本月班數平均",
        "autoRun:allowOverlappingDemands:允許同一人同時段填進多筆人力需求",
      ]
    `);
  });

  it("預設等級照表:畫休上下限、同日最多畫休人數是限制;同一時段兼多個崗位預設關閉", () => {
    expect(definition("maxMonthlyDayOffs").defaults.level).toBe("limit");
    expect(definition("minMonthlyDayOffs").defaults.level).toBe("limit");
    expect(definition("maxDailyDayOffStaff").defaults.level).toBe("limit");
    expect(definition("maxConsecutiveWorkDays").defaults.level).toBe(
      "reminder",
    );
    expect(definition("dayOffWindow").defaults.level).toBeNull();
    expect(definition("multiPositionOverlap").defaults.enabled).toBe(false);
    expect(definition("entryMatchToleranceMinutes").defaults.value).toEqual({
      amount: 60,
    });
    expect(definition("graceMinutes").defaults.value).toEqual({
      lateGraceMinutes: 5,
      earlyLeaveGraceMinutes: 5,
    });
  });

  it("key 唯一", () => {
    const keys = SCHEDULE_RULE_DEFINITIONS.map((rule) => rule.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("每條規則的程式預設值本身合法", () => {
    for (const rule of SCHEDULE_RULE_DEFINITIONS) {
      expect(scheduleRuleValueErrors(rule, rule.defaults.value)).toEqual([]);
    }
  });

  it.each([
    ["maxMonthlyDayOffs", { amount: 32 }, ["amount"]],
    ["maxMonthlyDayOffs", { amount: 1.5 }, ["amount"]],
    ["maxDailyWorkHours", { amount: 7.5 }, []],
    ["maxDailyWorkHours", { amount: 7.25 }, ["amount"]],
    ["dayOffWindow", { startDay: 25, endDay: 15 }, ["endDay"]],
    ["dayOffWindow", { startDay: 0, endDay: 15 }, ["startDay"]],
    [
      "graceMinutes",
      { lateGraceMinutes: -1, earlyLeaveGraceMinutes: 5 },
      ["lateGraceMinutes"],
    ],
    ["defaultBreaks", { tiers: [] }, ["tiers"]],
    [
      "defaultBreaks",
      {
        tiers: [
          { minMinutes: 240, breakMinutes: 30 },
          { minMinutes: 240, breakMinutes: 60 },
        ],
      },
      ["tiers"],
    ],
    [
      "defaultTasks",
      { defaultLeaderTaskKey: "", defaultHelperTaskKey: "x" },
      ["defaultLeaderTaskKey"],
    ],
    ["autoDemandWeekTemplateId", { weekTemplateId: 3 }, ["weekTemplateId"]],
    ["understaffed", "8", ["value"]],
  ])("%s 的值 %j → 不合法欄位 %j", (key, value, errors) => {
    expect(scheduleRuleValueErrors(definition(key), value)).toEqual(errors);
  });
});

describe("哪些規則可以關掉", () => {
  it("只有人力不足、同一時段兼多個崗位與自動排班條件", () => {
    expect(
      SCHEDULE_RULE_DEFINITIONS.filter((rule) =>
        isScheduleRuleToggleable(rule),
      ).map((rule) => rule.key),
    ).toEqual([
      "understaffed",
      "multiPositionOverlap",
      "continuePreviousEntry",
      "leaderCountFirst",
      "monthlyShiftBalance",
      "allowOverlappingDemands",
    ]);
  });
});

describe("規則值只留定義裡的欄位", () => {
  it("多送的 key 丟掉;預設休息每一級也只留兩欄", () => {
    expect(
      pickScheduleRuleValue(definition("maxMonthlyDayOffs"), {
        amount: 8,
        extra: "x",
      }),
    ).toEqual({ amount: 8 });
    expect(
      pickScheduleRuleValue(definition("defaultBreaks"), {
        tiers: [{ minMinutes: 240, breakMinutes: 30, note: "x" }],
        other: 1,
      }),
    ).toEqual({ tiers: [{ minMinutes: 240, breakMinutes: 30 }] });
    expect(pickScheduleRuleValue(definition("understaffed"), { a: 1 })).toEqual(
      {},
    );
  });
});

describe("排班設定的固定值", () => {
  it("負責人超過 1 筆、協同超過 10 筆", () => {
    const leaders = [{ role: "leader" }, { role: "leader" }];
    const helpers = Array.from({ length: 11 }, () => ({ role: "helper" }));
    expect(exceededTaskRoles(leaders)).toEqual(["leader"]);
    expect(exceededTaskRoles(helpers)).toEqual(["helper"]);
    expect(
      exceededTaskRoles([{ role: "leader" }, ...helpers.slice(1)]),
    ).toEqual([]);
  });

  it.each([
    ["早", true],
    ["早班", true],
    ["早班一", false],
    [" ", false],
  ])("簡稱 %p → %p", (value, expected) => {
    expect(isTemplateShortName(value)).toBe(expected);
  });

  it("時間與日期格式", () => {
    expect(isHhMm("08:30")).toBe(true);
    expect(isHhMm("24:00")).toBe(false);
    expect(isHhMm("8:30")).toBe(false);
    expect(minutesOfHhMm("13:45")).toBe(825);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoMonth("2026-11")).toBe(true);
    expect(isIsoMonth("2026-13")).toBe(false);
  });
});
