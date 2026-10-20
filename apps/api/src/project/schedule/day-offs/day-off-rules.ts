import type { ScheduleRuleLevel } from "@repo/domain/project/schedule-settings";

import {
  type EffectiveRuleSetting,
  type ScheduleRuleEvaluationContext,
  type ScheduleRuleEvaluator,
  type ScheduleRuleViolation,
  registerRuleEvaluator,
  ruleEvaluatorOf,
} from "../rules/rule-registry";
import { shiftDate } from "./day-off-window";

/**
 * 畫休類規則的檢查函式(規格 14.2;本功能擁有):登記在 P06 的 `registerRuleEvaluator`,
 * 畫休登記、代改、之後的排班檢核 / 發布都經同一份登記呼叫(`ruleEvaluatorOf(key)`)。
 *
 * **畫休的算法**(規格 14.2):那一天只要有任何畫休(整天畫休或時段不可排)就算 **1 天畫休**,
 * 也算 **1 個畫休人數**;每月最多 / 最少畫休、同日最多畫休人數都這樣算;「最多連續休假」只算整天畫休。
 */

/** 檢查只看得到這幾個欄位(資料表一筆 = 一段畫休)。 */
export interface DayOffLike {
  userId: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `full-day` / `time-range` */
  kind: string;
}

/** 人的規則(每月最多 / 最少畫休、最多連續休假)的資料:這個人、這個月。 */
export interface PersonDayOffData {
  userId: string;
  /** 檢查的月份 `YYYY-MM` */
  month: string;
  /** 這個人的畫休;連續休假會跨月,呼叫端給前後一個月的資料 */
  dayOffs: readonly DayOffLike[];
}

/** 店的規則(同日最多畫休人數)的資料:這家店、這個月。 */
export interface StoreDayOffData {
  month: string;
  /** **以這家店為主要分店的人**的畫休(規格 14.2:只計入這些人) */
  dayOffs: readonly DayOffLike[];
}

export const DAY_OFF_PERSON_RULE_KEYS = [
  "maxMonthlyDayOffs",
  "minMonthlyDayOffs",
  "maxConsecutiveDaysOff",
] as const;
export const DAY_OFF_STORE_RULE_KEY = "maxDailyDayOffStaff";
export const DAY_OFF_RULE_KEYS = [
  ...DAY_OFF_PERSON_RULE_KEYS,
  DAY_OFF_STORE_RULE_KEY,
] as const;

/** 這個人的畫休日(任何一種都算,同一天只算一次),依日期排序。 */
export function dayOffDates(
  dayOffs: readonly DayOffLike[],
  userId: string,
): string[] {
  return [
    ...new Set(
      dayOffs
        .filter((dayOff) => dayOff.userId === userId)
        .map((dayOff) => dayOff.date),
    ),
  ].toSorted((left, right) => left.localeCompare(right));
}

/** 這個人的整天畫休日(最多連續休假只算這種),依日期排序。 */
export function fullDayOffDates(
  dayOffs: readonly DayOffLike[],
  userId: string,
): string[] {
  return dayOffDates(
    dayOffs.filter((dayOff) => dayOff.kind === "full-day"),
    userId,
  );
}

/** 每天的畫休人數(有任何一種畫休的人,同一人同一天只算一次)。 */
export function dayOffStaffCounts(
  dayOffs: readonly DayOffLike[],
): Map<string, number> {
  const usersByDate = new Map<string, Set<string>>();
  for (const dayOff of dayOffs) {
    const users = usersByDate.get(dayOff.date) ?? new Set<string>();
    users.add(dayOff.userId);
    usersByDate.set(dayOff.date, users);
  }
  return new Map(
    [...usersByDate].map(([date, users]) => [date, users.size] as const),
  );
}

/** 連續的日期段(已排序、不重複的日期)。 */
export function consecutiveRuns(
  dates: readonly string[],
): { from: string; to: string; length: number }[] {
  const runs: { from: string; to: string; length: number }[] = [];
  for (const date of dates) {
    const last = runs.at(-1);
    if (last !== undefined && shiftDate(last.to, 1) === date) {
      last.to = date;
      last.length += 1;
    } else {
      runs.push({ from: date, to: date, length: 1 });
    }
  }
  return runs;
}

const amountOf = (setting: EffectiveRuleSetting): number =>
  Number(setting.value.amount ?? 0);

const levelOf = (setting: EffectiveRuleSetting): ScheduleRuleLevel =>
  setting.level ?? "limit";

const inMonth = (date: string, month: string) => date.startsWith(`${month}-`);

const shortDate = (date: string) =>
  `${String(Number(date.slice(5, 7)))}/${String(Number(date.slice(8, 10)))}`;

export const maxMonthlyDayOffsEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<PersonDayOffData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  const dates = dayOffDates(data.dayOffs, data.userId).filter((date) =>
    inMonth(date, data.month),
  );
  const limit = amountOf(setting);
  return dates.length > limit
    ? [
        {
          key: setting.key,
          level: levelOf(setting),
          message: `本月畫休 ${String(dates.length)} 天,上限 ${String(limit)} 天`,
          targets: dates.map((date) => ({ userId: data.userId, date })),
          detail: { actual: dates.length, limit },
        },
      ]
    : [];
};

export const minMonthlyDayOffsEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<PersonDayOffData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  const count = dayOffDates(data.dayOffs, data.userId).filter((date) =>
    inMonth(date, data.month),
  ).length;
  const limit = amountOf(setting);
  return count < limit
    ? [
        {
          key: setting.key,
          level: levelOf(setting),
          message: `本月畫休 ${String(count)} 天,下限 ${String(limit)} 天`,
          targets: [{ userId: data.userId }],
          detail: { actual: count, limit },
        },
      ]
    : [];
};

export const maxConsecutiveDaysOffEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<PersonDayOffData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  const limit = amountOf(setting);
  const monthStart = `${data.month}-01`;
  const monthEnd = `${data.month}-31`;
  return consecutiveRuns(fullDayOffDates(data.dayOffs, data.userId))
    .filter(
      (run) =>
        run.length > limit && run.to >= monthStart && run.from <= monthEnd,
    )
    .map((run) => ({
      key: setting.key,
      level: levelOf(setting),
      message: `${shortDate(run.from)}–${shortDate(run.to)} 連續休 ${String(run.length)} 天,最多 ${String(limit)} 天`,
      targets: Array.from({ length: run.length }, (_, index) => ({
        userId: data.userId,
        date: shiftDate(run.from, index),
      })),
      detail: { actual: run.length, limit, from: run.from, to: run.to },
    }));
};

export const maxDailyDayOffStaffEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<StoreDayOffData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  const limit = amountOf(setting);
  return [...dayOffStaffCounts(data.dayOffs)]
    .filter(([date, count]) => inMonth(date, data.month) && count > limit)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({
      key: setting.key,
      level: levelOf(setting),
      message: `${shortDate(date)} 畫休 ${String(count)} 人,同日最多 ${String(limit)} 人`,
      targets: [
        { date },
        ...[
          ...new Set(
            data.dayOffs
              .filter((dayOff) => dayOff.date === date)
              .map((dayOff) => dayOff.userId),
          ),
        ].map((userId) => ({ userId, date })),
      ],
      detail: { actual: count, limit, from: date, to: date },
    }));
};

const EVALUATORS: readonly [string, ScheduleRuleEvaluator<never>][] = [
  ["maxMonthlyDayOffs", maxMonthlyDayOffsEvaluator],
  ["minMonthlyDayOffs", minMonthlyDayOffsEvaluator],
  ["maxConsecutiveDaysOff", maxConsecutiveDaysOffEvaluator],
  [DAY_OFF_STORE_RULE_KEY, maxDailyDayOffStaffEvaluator],
];

/** 登記畫休類規則的檢查函式(已登記的略過;模組啟動時呼叫)。 */
export function registerDayOffRuleEvaluators(): void {
  for (const [key, evaluator] of EVALUATORS) {
    if (ruleEvaluatorOf(key) === null) {
      registerRuleEvaluator(key, evaluator);
    }
  }
}

/**
 * 跑一個人(與他的主要分店)的畫休類規則:經規則登記呼叫(同一份檢查函式),依生效設定。
 * 人的規則給這個人的資料;店的規則給主要分店的資料。
 */
export async function evaluateDayOffRules(input: {
  tenantId: string;
  /** 主要分店(人的規則用它的設定;店的規則檢查它) */
  orgId: string;
  settings: ReadonlyMap<string, EffectiveRuleSetting>;
  person: PersonDayOffData;
  store: StoreDayOffData;
}): Promise<ScheduleRuleViolation[]> {
  const violations: ScheduleRuleViolation[] = [];
  for (const key of DAY_OFF_RULE_KEYS) {
    const setting = input.settings.get(key);
    const evaluator = ruleEvaluatorOf(key);
    if (setting === undefined || evaluator === null) {
      continue;
    }
    const context: ScheduleRuleEvaluationContext = {
      tenantId: input.tenantId,
      orgId: input.orgId,
      setting,
      data: key === DAY_OFF_STORE_RULE_KEY ? input.store : input.person,
    };
    violations.push(...(await evaluator(context)));
  }
  return violations;
}
