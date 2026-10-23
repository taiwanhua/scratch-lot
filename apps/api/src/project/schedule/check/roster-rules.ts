import type { ScheduleRuleLevel } from "@repo/domain/project/schedule-settings";

import { consecutiveRuns } from "../day-offs/day-off-rules";
import { workMinutesOf } from "../roster/roster-stats";
import {
  type EffectiveRuleSetting,
  type ScheduleRuleEvaluationContext,
  type ScheduleRuleEvaluator,
  type ScheduleRuleViolation,
  type UnderstaffedDetail,
  registerRuleEvaluator,
  ruleEvaluatorOf,
} from "../rules/rule-registry";
import { shiftDateKey } from "../shared/schedule-dates";

/**
 * 排班類規則的檢查函式(規格 14.2;本功能擁有):登記在 P06 的 `registerRuleEvaluator`,
 * 存排班、檢核面板、發布都經同一份登記呼叫(`ruleEvaluatorOf(key)`)、吃同一份生效設定。
 *
 * - 最多連續上班(人):有排班(任何分店)的日子連續超過 N 天
 * - 兩班之間最少休息(人):相鄰兩個上班日,前一天最後下班到後一天第一次上班不到 N 小時
 *   (同一天的多段排班之間不算,那是同一天的班)
 * - 每天最多上班時數(人):同一天所有排班(同店多段、跨店都算)的「下班 − 上班 − 休息」加總超過 N 小時;
 *   跨午夜的班算開始那天(`date`)
 * - 同一時段兼多個崗位(人,預設關閉):同一筆排班在同一段時間填進兩筆以上人力需求
 * - 人力不足(店):依時間切段檢查空的執行任務(沒人填、或填的人只上一部分時間),附那段時間可排幾人與原因
 *
 * 檢查函式是純函式;資料(排班、畫休、人力需求)由呼叫端準備(`ScheduleCheckService`)。
 */

/** 檢查看得到的一筆排班(任何分店)。 */
export interface WorkEntryLike {
  id: string;
  userId: string;
  orgId: string;
  /** `YYYY-MM-DD`(上班時點的當地日期;跨午夜算開始那天) */
  date: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
  /** 填進的人力需求的時間(兼多個崗位用;用不到時給空陣列) */
  demands: readonly { demandId: string; startAt: Date; endAt: Date }[];
}

/** 人的規則的資料:這個人、這個月;連續上班會跨月,呼叫端給前後各一個月的排班。 */
export interface PersonWorkData {
  userId: string;
  /** `YYYY-MM` */
  month: string;
  entries: readonly WorkEntryLike[];
}

/** 人力不足的資料:這家店、這個月(店休那天的人力需求由呼叫端排除)。 */
export interface UnderstaffedData {
  month: string;
  demands: readonly UnderstaffedDemandLike[];
  /** 可以排這家店的人 */
  candidates: readonly { userId: string; canLead: boolean }[];
  /** 這些人不能排的時間:排班(任何分店)、整天畫休、時段不可排 */
  busy: readonly BusyLike[];
}

export interface UnderstaffedDemandLike {
  id: string;
  date: string;
  startAt: Date;
  endAt: Date;
  tasks: readonly {
    taskId: string;
    role: string;
    /** 填的人的那筆排班;沒人填 = null */
    filledBy: { startAt: Date; endAt: Date } | null;
  }[];
}

export interface BusyLike {
  userId: string;
  kind: "entry" | "full-day" | "time-range";
  startAt: Date;
  endAt: Date;
}

export const ROSTER_PERSON_RULE_KEYS = [
  "maxConsecutiveWorkDays",
  "minRestBetweenShifts",
  "maxDailyWorkHours",
  "multiPositionOverlap",
] as const;
export const UNDERSTAFFED_RULE_KEY = "understaffed";

const MS_PER_HOUR = 3_600_000;

const amountOf = (setting: EffectiveRuleSetting): number =>
  Number(setting.value.amount ?? 0);

const levelOf = (setting: EffectiveRuleSetting): ScheduleRuleLevel =>
  setting.level ?? "reminder";

const inMonth = (date: string, month: string) => date.startsWith(`${month}-`);

const shortDate = (date: string) =>
  `${String(Number(date.slice(5, 7)))}/${String(Number(date.slice(8, 10)))}`;

/** 小時,到小數第 2 位(10.5、7.75)。 */
const hoursOf = (ms: number) => Math.round((ms / MS_PER_HOUR) * 100) / 100;

const byStart = (left: { startAt: Date }, right: { startAt: Date }) =>
  left.startAt.getTime() - right.startAt.getTime();

function ownEntries(data: PersonWorkData): WorkEntryLike[] {
  return data.entries
    .filter((entry) => entry.userId === data.userId)
    .toSorted(byStart);
}

function groupByDate(
  entries: readonly WorkEntryLike[],
): Map<string, WorkEntryLike[]> {
  const byDate = new Map<string, WorkEntryLike[]>();
  for (const entry of entries) {
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  }
  return new Map(
    [...byDate].toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

const targetOf = (entry: WorkEntryLike) => ({
  entryId: entry.id,
  userId: entry.userId,
  date: entry.date,
});

export const maxConsecutiveWorkDaysEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<PersonWorkData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  const limit = amountOf(setting);
  const entries = ownEntries(data);
  const dates = [...groupByDate(entries).keys()];
  const monthStart = `${data.month}-01`;
  const monthEnd = `${data.month}-31`;
  return consecutiveRuns(dates)
    .filter(
      (run) =>
        run.length > limit && run.to >= monthStart && run.from <= monthEnd,
    )
    .map((run) => ({
      key: setting.key,
      level: levelOf(setting),
      message: `${shortDate(run.from)}–${shortDate(run.to)} 連續上班 ${String(run.length)} 天,最多 ${String(limit)} 天`,
      targets: entries
        .filter((entry) => entry.date >= run.from && entry.date <= run.to)
        .map((entry) => targetOf(entry)),
      detail: { actual: run.length, limit, from: run.from, to: run.to },
    }));
};

export const minRestBetweenShiftsEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<PersonWorkData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  const limit = amountOf(setting);
  const days = [...groupByDate(ownEntries(data))];
  const violations: ScheduleRuleViolation[] = [];
  for (const [index, [date, entries]] of days.entries()) {
    const following = days[index + 1];
    if (following === undefined) {
      continue;
    }
    const [nextDate, nextEntries] = following;
    if (!inMonth(date, data.month) && !inMonth(nextDate, data.month)) {
      continue;
    }
    const [previous] = entries.toSorted(
      (left, right) => right.endAt.getTime() - left.endAt.getTime(),
    );
    const [next] = nextEntries;
    if (previous === undefined || next === undefined) {
      continue;
    }
    const rest = next.startAt.getTime() - previous.endAt.getTime();
    if (rest >= limit * MS_PER_HOUR) {
      continue;
    }
    violations.push({
      key: setting.key,
      level: levelOf(setting),
      message: `${shortDate(date)} 到 ${shortDate(nextDate)} 只休息 ${String(hoursOf(rest))} 小時,最少 ${String(limit)} 小時`,
      targets: [targetOf(previous), targetOf(next)],
      detail: {
        actual: hoursOf(rest),
        limit,
        from: date,
        to: nextDate,
        startAt: previous.endAt,
        endAt: next.startAt,
      },
    });
  }
  return violations;
};

export const maxDailyWorkHoursEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<PersonWorkData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  const limit = amountOf(setting);
  return [...groupByDate(ownEntries(data))].flatMap(([date, entries]) => {
    if (!inMonth(date, data.month)) {
      return [];
    }
    const minutes = entries.reduce(
      (sum, entry) => sum + workMinutesOf(entry),
      0,
    );
    if (minutes <= limit * 60) {
      return [];
    }
    const actual = Math.round((minutes / 60) * 100) / 100;
    return [
      {
        key: setting.key,
        level: levelOf(setting),
        message: `${shortDate(date)} 排 ${String(actual)} 小時,最多 ${String(limit)} 小時`,
        targets: entries.map((entry) => targetOf(entry)),
        detail: { actual, limit, from: date, to: date },
      },
    ];
  });
};

/** 一筆排班裡,填進的人力需求(各自截到排班的時間)兩兩重疊的那段。 */
function overlapOf(
  entry: WorkEntryLike,
): { count: number; startAt: number; endAt: number } | null {
  const windows = entry.demands
    .map((demand) => ({
      start: Math.max(demand.startAt.getTime(), entry.startAt.getTime()),
      end: Math.min(demand.endAt.getTime(), entry.endAt.getTime()),
    }))
    .filter((window) => window.end > window.start);
  const involved = new Set<number>();
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const [index, left] of windows.entries()) {
    for (const [otherIndex, right] of windows.entries()) {
      if (otherIndex <= index) {
        continue;
      }
      const from = Math.max(left.start, right.start);
      const to = Math.min(left.end, right.end);
      if (to > from) {
        involved.add(index);
        involved.add(otherIndex);
        start = Math.min(start, from);
        end = Math.max(end, to);
      }
    }
  }
  return involved.size === 0
    ? null
    : { count: involved.size, startAt: start, endAt: end };
}

export const multiPositionOverlapEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<PersonWorkData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  return ownEntries(data).flatMap((entry) => {
    if (!inMonth(entry.date, data.month)) {
      return [];
    }
    const overlap = overlapOf(entry);
    return overlap === null
      ? []
      : [
          {
            key: setting.key,
            level: levelOf(setting),
            message: `${shortDate(entry.date)} 同一筆排班同時填進 ${String(overlap.count)} 筆人力需求`,
            targets: [targetOf(entry)],
            detail: {
              actual: overlap.count,
              from: entry.date,
              to: entry.date,
              startAt: new Date(overlap.startAt),
              endAt: new Date(overlap.endAt),
            },
          },
        ];
  });
};

/** 一筆執行任務沒人顧的時段:沒人填 = 整段;有人填 = 人力需求的時間扣掉那筆排班的時間。 */
function missingWindows(
  demand: UnderstaffedDemandLike,
  task: UnderstaffedDemandLike["tasks"][number],
): { start: number; end: number }[] {
  const start = demand.startAt.getTime();
  const end = demand.endAt.getTime();
  if (task.filledBy === null) {
    return [{ start, end }];
  }
  const filledStart = Math.max(start, task.filledBy.startAt.getTime());
  const filledEnd = Math.min(end, task.filledBy.endAt.getTime());
  if (filledEnd <= filledStart) {
    return [{ start, end }];
  }
  return [
    { start, end: filledStart },
    { start: filledEnd, end },
  ].filter((window) => window.end > window.start);
}

/** 依時間切段:每一段缺幾筆(相鄰、缺的筆數一樣的合併)。 */
function missingSegments(
  demand: UnderstaffedDemandLike,
  role: string,
): { start: number; end: number; missing: number }[] {
  const windows = demand.tasks
    .filter((task) => task.role === role)
    .map((task) => missingWindows(demand, task));
  const points = [
    ...new Set(windows.flat().flatMap((window) => [window.start, window.end])),
  ].toSorted((left, right) => left - right);
  const segments: { start: number; end: number; missing: number }[] = [];
  for (const [index, start] of points.entries()) {
    const end = points[index + 1];
    if (end === undefined) {
      continue;
    }
    const missing = windows.filter((list) =>
      list.some((window) => window.start <= start && window.end >= end),
    ).length;
    const last = segments.at(-1);
    if (missing === 0) {
      continue;
    }
    if (last?.end === start && last.missing === missing) {
      last.end = end;
    } else {
      segments.push({ start, end, missing });
    }
  }
  return segments;
}

/** 那段時間可排幾人,與不能排的原因(每人只算第一個原因:不能負責 → 整天畫休 → 時段不可排 → 已排其他班)。 */
function availabilityOf(
  data: UnderstaffedData,
  role: string,
  start: number,
  end: number,
): Omit<UnderstaffedDetail, "demandId" | "role" | "missing"> {
  const counts = {
    available: 0,
    dayOff: 0,
    timeRange: 0,
    occupied: 0,
    cannotLead: 0,
  };
  for (const candidate of data.candidates) {
    if (role === "leader" && !candidate.canLead) {
      counts.cannotLead += 1;
      continue;
    }
    const busy = data.busy.filter(
      (item) =>
        item.userId === candidate.userId &&
        item.startAt.getTime() < end &&
        item.endAt.getTime() > start,
    );
    if (busy.some((item) => item.kind === "full-day")) {
      counts.dayOff += 1;
    } else if (busy.some((item) => item.kind === "time-range")) {
      counts.timeRange += 1;
    } else if (busy.length > 0) {
      counts.occupied += 1;
    } else {
      counts.available += 1;
    }
  }
  return counts;
}

const ROLE_LABELS: Record<string, string> = { leader: "負責", helper: "協同" };

export const understaffedEvaluator = ({
  setting,
  data,
}: ScheduleRuleEvaluationContext<UnderstaffedData>): ScheduleRuleViolation[] => {
  if (!setting.enabled) {
    return [];
  }
  return data.demands
    .filter((demand) => inMonth(demand.date, data.month))
    .toSorted(
      (left, right) =>
        left.startAt.getTime() - right.startAt.getTime() ||
        left.id.localeCompare(right.id),
    )
    .flatMap((demand) =>
      ["leader", "helper"].flatMap((role) =>
        missingSegments(demand, role).map((segment) => {
          const availability = availabilityOf(
            data,
            role,
            segment.start,
            segment.end,
          );
          return {
            key: setting.key,
            level: levelOf(setting),
            message: `${shortDate(demand.date)} 缺 ${String(segment.missing)} 人(${ROLE_LABELS[role] ?? role}),可排 ${String(availability.available)} 人`,
            targets: [{ date: demand.date }],
            detail: {
              actual: segment.missing,
              from: demand.date,
              to: demand.date,
              startAt: new Date(segment.start),
              endAt: new Date(segment.end),
              understaffed: {
                demandId: demand.id,
                role,
                missing: segment.missing,
                ...availability,
              },
            },
          };
        }),
      ),
    );
};

const EVALUATORS: readonly [string, ScheduleRuleEvaluator<never>][] = [
  ["maxConsecutiveWorkDays", maxConsecutiveWorkDaysEvaluator],
  ["minRestBetweenShifts", minRestBetweenShiftsEvaluator],
  ["maxDailyWorkHours", maxDailyWorkHoursEvaluator],
  ["multiPositionOverlap", multiPositionOverlapEvaluator],
  [UNDERSTAFFED_RULE_KEY, understaffedEvaluator],
];

/** 登記排班類規則的檢查函式(已登記的略過;模組啟動時呼叫)。 */
export function registerRosterRuleEvaluators(): void {
  for (const [key, evaluator] of EVALUATORS) {
    if (ruleEvaluatorOf(key) === null) {
      registerRuleEvaluator(key, evaluator);
    }
  }
}

/** 跑一個人的排班類規則(經規則登記呼叫,依生效設定;人的規則用他主要分店的設定)。 */
export async function evaluatePersonWorkRules(input: {
  tenantId: string;
  orgId: string;
  settings: ReadonlyMap<string, EffectiveRuleSetting>;
  person: PersonWorkData;
}): Promise<ScheduleRuleViolation[]> {
  const violations: ScheduleRuleViolation[] = [];
  for (const key of ROSTER_PERSON_RULE_KEYS) {
    const setting = input.settings.get(key);
    const evaluator = ruleEvaluatorOf(key);
    if (setting === undefined || evaluator === null) {
      continue;
    }
    violations.push(
      ...(await evaluator({
        tenantId: input.tenantId,
        orgId: input.orgId,
        setting,
        data: input.person,
      })),
    );
  }
  return violations;
}

/** 前後相差的日期(給「前後各一個月」的讀取範圍)。 */
export function widenedRange(
  from: string,
  to: string,
  days: number,
): { from: string; to: string } {
  return { from: shiftDateKey(from, -days), to: shiftDateKey(to, days) };
}

/**
 * 違反的嚴重程度(每條規則):限制等級的違反超出規則值多少的加總(兼多個崗位 = 重疊筆數)。
 * 存排班時「存檔後比存檔前嚴重」才擋(和畫休規則同一個想法)。
 */
export function limitSeverityByKey(
  violations: readonly ScheduleRuleViolation[],
): Map<string, number> {
  const severity = new Map<string, number>();
  for (const violation of violations) {
    if (violation.level !== "limit") {
      continue;
    }
    const { actual = 1, limit } = violation.detail ?? {};
    const amount = limit === undefined ? actual : Math.abs(actual - limit);
    severity.set(
      violation.key,
      (severity.get(violation.key) ?? 0) + Math.max(amount, 0.01),
    );
  }
  return severity;
}
