/**
 * 排班規則與自動排班條件的**定義**(規格 14.2、14.5「自動排班」):前後端共用同一份清單。
 *
 * 形狀照規格 14.1 `schedule_settings` 的 `{key, group, label, valueType, unit, range, defaults, run}`;
 * `run`(檢查函式)不在這裡 —— api 的 `rule-registry.ts` 以 `registerRuleEvaluator(key, evaluator)` 登記。
 * 規則頁一條規則一列、**依本清單順序**(= 規格 14.2 表的順序);自動排班條件另成一組列在最下面。
 *
 * 值一律是物件(存進 `schedule_settings.value`),形狀依 `valueType`:
 *
 * | valueType      | 值                                                             |
 * | -------------- | -------------------------------------------------------------- |
 * | `amount`       | `{ amount: number }`(整數;`range.step` 0.5 時可到 0.5)       |
 * | `dayRange`     | `{ startDay: number, endDay: number }`(每月 N 日至 M 日)       |
 * | `weekTemplate` | `{ weekTemplateId: string \| null }`(人力需求週範本)           |
 * | `grace`        | `{ lateGraceMinutes: number, earlyLeaveGraceMinutes: number }` |
 * | `breakTiers`   | `{ tiers: { minMinutes: number, breakMinutes: number }[] }`    |
 * | `defaultTasks` | `{ defaultLeaderTaskKey: string, defaultHelperTaskKey: string }` |
 * | `none`         | `{}`(只有開關 / 等級,例:人力不足、自動排班條件)               |
 */

/** 規則頁的兩組:規則、自動排班條件(整組繼承)。 */
export type ScheduleRuleGroup = "rule" | "autoRun";

/** 規則等級:限制(紅,不能存、不能發布)/ 提醒(橘,照樣存與發布)。 */
export const SCHEDULE_RULE_LEVELS = ["limit", "reminder"] as const;
export type ScheduleRuleLevel = (typeof SCHEDULE_RULE_LEVELS)[number];

export type ScheduleRuleValueType =
  | "amount"
  | "dayRange"
  | "weekTemplate"
  | "grace"
  | "breakTiers"
  | "defaultTasks"
  | "none";

/** 值的單位(畫面上的「天」「人」「小時」「分鐘」)。 */
export type ScheduleRuleUnit = "day" | "person" | "hour" | "minute";

/** 規則的範圍:檢查對象是人(人的規則用主要分店的設定)還是店。 */
export type ScheduleRuleScope = "person" | "store";

export interface ScheduleRuleRange {
  min: number;
  max: number;
  /** 1 = 整數;0.5 = 可到 0.5 */
  step: number;
}

export interface ScheduleRuleDefaults {
  /** 程式預設值(整條鏈上都沒有設定時用它) */
  value: Record<string, unknown>;
  /** 開關:「同一時段兼多個崗位」預設關、自動排班條件「允許…」等預設不勾 */
  enabled: boolean;
  /** 有等級的規則的預設等級;沒有等級的規則為 `null` */
  level: ScheduleRuleLevel | null;
  /** 檢核清單排序(同等級內依它排) */
  order: number;
}

export interface ScheduleRuleDefinition {
  key: string;
  group: ScheduleRuleGroup;
  /** 規格名詞(api 端的稽核與錯誤訊息用;admin 的畫面文字在 i18n `schedule.rules.labels.<key>`) */
  label: string;
  valueType: ScheduleRuleValueType;
  unit: ScheduleRuleUnit | null;
  range: ScheduleRuleRange | null;
  scope: ScheduleRuleScope;
  defaults: ScheduleRuleDefaults;
}

/** 負責人 / 協同預設任務的程式預設值(欄位管理「執行任務」的種子選項 value)。 */
export const DEFAULT_LEADER_TASK_KEY = "store-and-accounts-lead";
export const DEFAULT_HELPER_TASK_KEY = "store-duties";

const DAYS_IN_MONTH: ScheduleRuleRange = { min: 0, max: 31, step: 1 };
const CONSECUTIVE_DAYS: ScheduleRuleRange = { min: 1, max: 31, step: 1 };
const MINUTES: ScheduleRuleRange = { min: 0, max: 720, step: 1 };

function amount(value: number): Record<string, unknown> {
  return { amount: value };
}

/** 規格 14.2 表的每一條,依表的順序。 */
export const SCHEDULE_RULE_DEFINITIONS: readonly ScheduleRuleDefinition[] = [
  {
    key: "maxMonthlyDayOffs",
    group: "rule",
    label: "每月最多畫休",
    valueType: "amount",
    unit: "day",
    range: DAYS_IN_MONTH,
    scope: "person",
    defaults: { value: amount(8), enabled: true, level: "limit", order: 1 },
  },
  {
    key: "minMonthlyDayOffs",
    group: "rule",
    label: "每月最少畫休",
    valueType: "amount",
    unit: "day",
    range: DAYS_IN_MONTH,
    scope: "person",
    defaults: { value: amount(4), enabled: true, level: "limit", order: 2 },
  },
  {
    key: "maxConsecutiveWorkDays",
    group: "rule",
    label: "最多連續上班",
    valueType: "amount",
    unit: "day",
    range: CONSECUTIVE_DAYS,
    scope: "person",
    defaults: { value: amount(6), enabled: true, level: "reminder", order: 3 },
  },
  {
    key: "maxConsecutiveDaysOff",
    group: "rule",
    label: "最多連續休假",
    valueType: "amount",
    unit: "day",
    range: CONSECUTIVE_DAYS,
    scope: "person",
    defaults: { value: amount(3), enabled: true, level: "reminder", order: 4 },
  },
  {
    key: "minRestBetweenShifts",
    group: "rule",
    label: "兩班之間最少休息",
    valueType: "amount",
    unit: "hour",
    range: { min: 0, max: 24, step: 1 },
    scope: "person",
    defaults: { value: amount(11), enabled: true, level: "reminder", order: 5 },
  },
  {
    key: "maxDailyWorkHours",
    group: "rule",
    label: "每天最多上班時數",
    valueType: "amount",
    unit: "hour",
    range: { min: 0.5, max: 24, step: 0.5 },
    scope: "person",
    defaults: { value: amount(8), enabled: true, level: "reminder", order: 6 },
  },
  {
    key: "dayOffWindow",
    group: "rule",
    label: "畫休開放期間",
    valueType: "dayRange",
    unit: null,
    range: { min: 1, max: 31, step: 1 },
    scope: "person",
    defaults: {
      value: { startDay: 15, endDay: 25 },
      enabled: true,
      level: null,
      order: 7,
    },
  },
  {
    key: "maxDailyDayOffStaff",
    group: "rule",
    label: "同日最多畫休人數",
    valueType: "amount",
    unit: "person",
    range: { min: 0, max: 99, step: 1 },
    scope: "store",
    defaults: { value: amount(2), enabled: true, level: "limit", order: 8 },
  },
  {
    key: "understaffed",
    group: "rule",
    label: "人力不足",
    valueType: "none",
    unit: null,
    range: null,
    scope: "store",
    defaults: { value: {}, enabled: true, level: "reminder", order: 9 },
  },
  {
    key: "multiPositionOverlap",
    group: "rule",
    label: "同一時段兼多個崗位",
    valueType: "none",
    unit: null,
    range: null,
    scope: "person",
    defaults: { value: {}, enabled: false, level: "reminder", order: 10 },
  },
  {
    key: "entryMatchToleranceMinutes",
    group: "rule",
    label: "對應排班容許時間",
    valueType: "amount",
    unit: "minute",
    range: MINUTES,
    scope: "store",
    defaults: { value: amount(60), enabled: true, level: null, order: 11 },
  },
  {
    key: "autoDemandWeekTemplateId",
    group: "rule",
    label: "預設人力需求週範本",
    valueType: "weekTemplate",
    unit: null,
    range: null,
    scope: "store",
    defaults: {
      value: { weekTemplateId: null },
      enabled: true,
      level: null,
      order: 12,
    },
  },
  {
    key: "graceMinutes",
    group: "rule",
    label: "遲到 / 早退寬限",
    valueType: "grace",
    unit: "minute",
    range: { min: 0, max: 120, step: 1 },
    scope: "store",
    defaults: {
      value: { lateGraceMinutes: 5, earlyLeaveGraceMinutes: 5 },
      enabled: true,
      level: null,
      order: 13,
    },
  },
  {
    key: "defaultBreaks",
    group: "rule",
    label: "預設休息",
    valueType: "breakTiers",
    unit: "minute",
    range: { min: 0, max: 1440, step: 1 },
    scope: "store",
    defaults: {
      value: {
        tiers: [
          { minMinutes: 240, breakMinutes: 30 },
          { minMinutes: 480, breakMinutes: 60 },
        ],
      },
      enabled: true,
      level: null,
      order: 14,
    },
  },
  {
    key: "defaultTasks",
    group: "rule",
    label: "負責人 / 協同預設任務",
    valueType: "defaultTasks",
    unit: null,
    range: null,
    scope: "store",
    defaults: {
      value: {
        defaultLeaderTaskKey: DEFAULT_LEADER_TASK_KEY,
        defaultHelperTaskKey: DEFAULT_HELPER_TASK_KEY,
      },
      enabled: true,
      level: null,
      order: 15,
    },
  },
  // ---- 自動排班條件(整組繼承;勾選 = enabled、拖拉排序 = order)----
  {
    key: "continuePreviousEntry",
    group: "autoRun",
    label: "延續同一人的排班",
    valueType: "none",
    unit: null,
    range: null,
    scope: "store",
    defaults: { value: {}, enabled: true, level: null, order: 1 },
  },
  {
    key: "leaderCountFirst",
    group: "autoRun",
    label: "負責人次數多者優先",
    valueType: "none",
    unit: null,
    range: null,
    scope: "store",
    defaults: { value: {}, enabled: true, level: null, order: 2 },
  },
  {
    key: "monthlyShiftBalance",
    group: "autoRun",
    label: "本月班數平均",
    valueType: "none",
    unit: null,
    range: null,
    scope: "store",
    defaults: { value: {}, enabled: false, level: null, order: 3 },
  },
  {
    key: "allowOverlappingDemands",
    group: "autoRun",
    label: "允許同一人同時段填進多筆人力需求",
    valueType: "none",
    unit: null,
    range: null,
    scope: "store",
    defaults: { value: {}, enabled: false, level: null, order: 4 },
  },
];

const DEFINITION_BY_KEY: ReadonlyMap<string, ScheduleRuleDefinition> = new Map(
  SCHEDULE_RULE_DEFINITIONS.map((definition) => [definition.key, definition]),
);

/** 依 key 取定義;不在清單 → `undefined`。 */
export function scheduleRuleDefinitionOf(
  key: string,
): ScheduleRuleDefinition | undefined {
  return DEFINITION_BY_KEY.get(key);
}

/** 這條規則有沒有等級(限制 / 提醒)。 */
export function hasRuleLevel(definition: ScheduleRuleDefinition): boolean {
  return definition.defaults.level !== null;
}

function isInRange(value: unknown, range: ScheduleRuleRange): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  if (value < range.min || value > range.max) {
    return false;
  }
  const steps = value / range.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

const INTEGER_MINUTES: ScheduleRuleRange = { min: 0, max: 1440, step: 1 };

function breakTierErrors(value: Record<string, unknown>): string[] {
  const { tiers } = value;
  if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > 10) {
    return ["tiers"];
  }
  const seen = new Set<number>();
  for (const tier of tiers as unknown[]) {
    if (typeof tier !== "object" || tier === null) {
      return ["tiers"];
    }
    const { minMinutes, breakMinutes } = tier as Record<string, unknown>;
    if (
      !isInRange(minMinutes, INTEGER_MINUTES) ||
      !isInRange(breakMinutes, INTEGER_MINUTES) ||
      seen.has(minMinutes as number)
    ) {
      return ["tiers"];
    }
    seen.add(minMinutes as number);
  }
  return [];
}

/**
 * 驗一條規則的值(形狀與範圍);回不合法的欄位名(空陣列 = 合法)。
 * 週範本是否存在、看不看得到由 api 另驗。
 */
export function scheduleRuleValueErrors(
  definition: ScheduleRuleDefinition,
  value: unknown,
): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["value"];
  }
  const record = value as Record<string, unknown>;
  const range = definition.range ?? { min: 0, max: 0, step: 1 };
  switch (definition.valueType) {
    case "amount": {
      return isInRange(record.amount, range) ? [] : ["amount"];
    }
    case "dayRange": {
      const errors = ["startDay", "endDay"].filter(
        (field) => !isInRange(record[field], range),
      );
      if (
        errors.length === 0 &&
        (record.startDay as number) > (record.endDay as number)
      ) {
        return ["endDay"];
      }
      return errors;
    }
    case "weekTemplate": {
      return record.weekTemplateId === null ||
        isNonEmptyString(record.weekTemplateId)
        ? []
        : ["weekTemplateId"];
    }
    case "grace": {
      return ["lateGraceMinutes", "earlyLeaveGraceMinutes"].filter(
        (field) => !isInRange(record[field], range),
      );
    }
    case "breakTiers": {
      return breakTierErrors(record);
    }
    case "defaultTasks": {
      return ["defaultLeaderTaskKey", "defaultHelperTaskKey"].filter(
        (field) => !isNonEmptyString(record[field]),
      );
    }
    case "none": {
      return [];
    }
  }
}

/** 每種 `valueType` 的值有哪些欄位(存檔前只保留這些,多送的丟掉)。 */
const VALUE_FIELDS: Record<ScheduleRuleValueType, readonly string[]> = {
  amount: ["amount"],
  dayRange: ["startDay", "endDay"],
  weekTemplate: ["weekTemplateId"],
  grace: ["lateGraceMinutes", "earlyLeaveGraceMinutes"],
  breakTiers: ["tiers"],
  defaultTasks: ["defaultLeaderTaskKey", "defaultHelperTaskKey"],
  none: [],
};

const TIER_FIELDS = ["minMinutes", "breakMinutes"] as const;

/**
 * 只留下規則定義裡有的欄位(預設休息的每一級也只留 `minMinutes` / `breakMinutes`);
 * 沒送的欄位不補。驗證另用 `scheduleRuleValueErrors`。
 */
export function pickScheduleRuleValue(
  definition: ScheduleRuleDefinition,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of VALUE_FIELDS[definition.valueType]) {
    if (field in value) {
      picked[field] = value[field];
    }
  }
  if (definition.valueType === "breakTiers" && Array.isArray(picked.tiers)) {
    picked.tiers = (picked.tiers as unknown[]).map((tier) => {
      if (typeof tier !== "object" || tier === null) {
        return tier;
      }
      const record = tier as Record<string, unknown>;
      return Object.fromEntries(
        TIER_FIELDS.filter((field) => field in record).map((field) => [
          field,
          record[field],
        ]),
      );
    });
  }
  return picked;
}

/** 規則裡可以切換開關的(其他規則一律開著,只能改值、等級、排序)。 */
const TOGGLEABLE_RULE_KEYS: ReadonlySet<string> = new Set([
  "understaffed",
  "multiPositionOverlap",
]);

/**
 * 這條能不能關掉:規則只有「人力不足」「同一時段兼多個崗位」;自動排班條件的開關就是勾選,一律可以。
 * 其他規則送 `enabled = false` → api 回 `VALIDATION_FAILED`(欄位 `enabled`)。
 */
export function isScheduleRuleToggleable(
  definition: ScheduleRuleDefinition,
): boolean {
  return (
    definition.group === "autoRun" || TOGGLEABLE_RULE_KEYS.has(definition.key)
  );
}
