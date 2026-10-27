import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "use-intl";

import { ScheduleRuleSource } from "@repo/graphql";
import { messages } from "@repo/i18n";

import {
  type RuleLookups,
  type RuleSettingLike,
  ruleParentText,
  ruleSourceText,
  ruleSummaryText,
  ruleValueText,
} from "./rule-display";

const t = createTranslator({
  locale: "zh-TW",
  timeZone: "UTC",
  messages: messages["zh-TW"],
  namespace: "admin.schedule.rules",
});
const translate = (key: string, values?: Record<string, string | number>) =>
  t(key as never, values as never);

const lookups: RuleLookups = {
  weekTemplateName: (id) => (id === "week-1" ? "一般週" : null),
  taskLabel: (key) =>
    ({
      "store-and-accounts-lead": "店內事務與帳目負責",
      "store-duties": "店內事務",
    })[key] ?? key,
};

const dayOffs = { key: "maxMonthlyDayOffs", valueType: "amount", unit: "day" };

const setting = (
  overrides: Partial<RuleSettingLike> & { value: Record<string, unknown> },
): RuleSettingLike => ({
  enabled: true,
  level: "limit",
  source: ScheduleRuleSource.Default,
  sourceOrgName: null,
  ...overrides,
});

describe("規則頁的文字(規格 14.2)", () => {
  it.each([
    {
      name: "租戶設 8、分店未設 → 沿用:<租戶名> 8 天",
      setting: setting({
        value: { amount: 8 },
        source: ScheduleRuleSource.Inherited,
        sourceOrgName: "好運彩券行",
      }),
      isTenantTop: false,
      summary: "沿用:好運彩券行 8 天",
    },
    {
      name: "分店自訂 6 → 本店自訂:6 天",
      setting: setting({
        value: { amount: 6 },
        source: ScheduleRuleSource.Own,
      }),
      isTenantTop: false,
      summary: "本店自訂:6 天",
    },
    {
      name: "看不到上層 → 沿用上層設定",
      setting: setting({
        value: { amount: 8 },
        source: ScheduleRuleSource.Inherited,
        sourceOrgName: null,
      }),
      isTenantTop: false,
      summary: "沿用上層設定 8 天",
    },
    {
      name: "整條鏈都沒設 → 系統預設",
      setting: setting({ value: { amount: 8 } }),
      isTenantTop: false,
      summary: "系統預設 8 天",
    },
    {
      name: "最上層組織自己自訂 → 本層自訂",
      setting: setting({
        value: { amount: 9 },
        source: ScheduleRuleSource.Own,
      }),
      isTenantTop: true,
      summary: "本層自訂:9 天",
    },
  ])("$name", ({ setting: current, isTenantTop, summary }) => {
    expect(
      ruleSummaryText(translate, dayOffs, current, isTenantTop, lookups),
    ).toBe(summary);
  });

  it("自訂的列下方顯示上層的值「上層:8 天」", () => {
    expect(
      ruleParentText(
        translate,
        dayOffs,
        setting({ value: { amount: 8 }, source: ScheduleRuleSource.Inherited }),
        lookups,
      ),
    ).toBe("上層:8 天");
  });

  it.each([
    [
      { key: "dayOffWindow", valueType: "dayRange" },
      { startDay: 15, endDay: 25 },
      "每月 15–25 日",
    ],
    [
      { key: "graceMinutes", valueType: "grace", unit: "minute" },
      { lateGraceMinutes: 5, earlyLeaveGraceMinutes: 5 },
      "5 分鐘 / 5 分鐘",
    ],
    [
      { key: "defaultBreaks", valueType: "breakTiers", unit: "minute" },
      {
        tiers: [
          { minMinutes: 240, breakMinutes: 30 },
          { minMinutes: 480, breakMinutes: 60 },
        ],
      },
      "滿 4 小時 30 分、滿 8 小時 60 分",
    ],
    [
      { key: "defaultTasks", valueType: "defaultTasks" },
      {
        defaultLeaderTaskKey: "store-and-accounts-lead",
        defaultHelperTaskKey: "store-duties",
      },
      "店內事務與帳目負責 / 店內事務",
    ],
    [
      { key: "autoDemandWeekTemplateId", valueType: "weekTemplate" },
      { weekTemplateId: "week-1" },
      "一般週",
    ],
    [
      { key: "autoDemandWeekTemplateId", valueType: "weekTemplate" },
      { weekTemplateId: null },
      "不設定",
    ],
    [
      { key: "maxDailyWorkHours", valueType: "amount", unit: "hour" },
      { amount: 7.5 },
      "7.5 小時",
    ],
    [{ key: "understaffed", valueType: "none" }, {}, "依人力需求"],
  ])("%j 的值 %j → %p", (rule, value, text) => {
    expect(ruleValueText(translate, rule, setting({ value }), lookups)).toBe(
      text,
    );
  });

  it("同一時段兼多個崗位:預設關閉", () => {
    expect(
      ruleValueText(
        translate,
        { key: "multiPositionOverlap", valueType: "none" },
        setting({ value: {}, enabled: false }),
        lookups,
      ),
    ).toBe("關閉");
  });

  it("來源:本店自訂 / 沿用", () => {
    expect(
      ruleSourceText(
        translate,
        setting({ value: {}, source: ScheduleRuleSource.Own }),
        false,
      ),
    ).toBe("本店自訂");
  });
});
