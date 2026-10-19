import {
  type LocalDate,
  instantOfLocalTime,
  localDateOf,
  localDateText,
} from "@repo/domain/form";

/**
 * 通知的「可調時間」(`docs/modules/notification-settings.md`「提醒時間」):
 * 通知類型可選填宣告一種寫法與預設值,租戶在通知設定頁調整「提前幾天、幾點寄」,整個租戶一套。
 * 日期本身(到期日、繳費日…)不在這裡,由排程工作從各自的資料帶進來。
 *
 * 時間一律以**租戶時區**計;寄送時間 15 分鐘一格(底座排程每 15 分鐘跑一次)。
 */

/** 某日期前 N 天(可多個,0 = 當天)的 `time` 寄。 */
export interface DaysBeforeSchedule {
  readonly kind: "days-before";
  /** 提前天數:0–365、1–5 個、不重複(順序照存,畫面依大到小顯示) */
  readonly daysBefore: readonly number[];
  /** `HH:mm`(24 小時制、15 分鐘一格) */
  readonly time: string;
}

/** 逾期後每天:日期的隔天起每天 `time` 寄,直到排程工作判斷不再逾期。 */
export interface DailyOverdueSchedule {
  readonly kind: "daily-overdue";
  readonly time: string;
}

/** 每月第 N 天(1–31;那個月沒有這一天就用月底)的 `time` 寄。 */
export interface MonthlySchedule {
  readonly kind: "monthly";
  readonly dayOfMonth: number;
  readonly time: string;
}

export type NotificationSchedule =
  DaysBeforeSchedule | DailyOverdueSchedule | MonthlySchedule;

export const NOTIFICATION_SCHEDULE_KINDS = [
  "days-before",
  "daily-overdue",
  "monthly",
] as const;

export type NotificationScheduleKind =
  (typeof NOTIFICATION_SCHEDULE_KINDS)[number];

/** 提前天數範圍與個數上限。 */
export const DAYS_BEFORE_MIN = 0;
export const DAYS_BEFORE_MAX = 365;
export const DAYS_BEFORE_MAX_COUNT = 5;
/** 每月第 N 天的範圍。 */
export const DAY_OF_MONTH_MIN = 1;
export const DAY_OF_MONTH_MAX = 31;
/** 寄送時間的格子(分鐘),也是排程的間隔。 */
export const SCHEDULE_STEP_MINUTES = 15;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const SLOT_MS = SCHEDULE_STEP_MINUTES * MS_PER_MINUTE;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 驗證不過的位置(`path`,例 `daysBefore[2]`)與原因代碼。 */
export interface ScheduleIssue {
  readonly path: string;
  readonly message: string;
}

export type ScheduleValidation =
  | { ok: true; schedule: NotificationSchedule }
  | { ok: false; issue: ScheduleIssue };

const fail = (path: string, message: string): ScheduleValidation => ({
  ok: false,
  issue: { path, message },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIntegerIn = (
  value: unknown,
  min: number,
  max: number,
): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

/** `HH:mm` 而且分鐘落在 15 分鐘格子上。 */
export function isScheduleTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = TIME_PATTERN.exec(value);
  return match !== null && Number(match[2]) % SCHEDULE_STEP_MINUTES === 0;
}

/**
 * 驗證一份提醒時間:形狀、範圍(提前天數 0–365、1–5 個、不重複;第 N 天 1–31;時間 15 分鐘一格),
 * 而且寫法必須是 `kind`(類型宣告的那一種)。多出的欄位視為格式不對。
 * 通過時回整理過的一份(只留該寫法的欄位)。
 */
export function validateSchedule(
  value: unknown,
  kind: NotificationScheduleKind,
): ScheduleValidation {
  if (!isRecord(value)) {
    return fail("", "提醒時間必須是物件");
  }
  if (value.kind !== kind) {
    return fail("kind", `寫法必須是 ${kind}`);
  }
  const allowed: Record<NotificationScheduleKind, readonly string[]> = {
    "days-before": ["kind", "daysBefore", "time"],
    "daily-overdue": ["kind", "time"],
    monthly: ["kind", "dayOfMonth", "time"],
  };
  const extra = Object.keys(value).find(
    (key) =>
      !allowed[kind].includes(key) &&
      value[key] !== undefined &&
      value[key] !== null,
  );
  if (extra !== undefined) {
    return fail(extra, `${kind} 沒有這個欄位`);
  }
  if (!isScheduleTime(value.time)) {
    return fail("time", "寄送時間必須是 HH:mm、15 分鐘一格");
  }
  const time = value.time;
  if (kind === "daily-overdue") {
    return { ok: true, schedule: { kind, time } };
  }
  if (kind === "monthly") {
    if (!isIntegerIn(value.dayOfMonth, DAY_OF_MONTH_MIN, DAY_OF_MONTH_MAX)) {
      return fail(
        "dayOfMonth",
        `每月第幾天必須是 ${String(DAY_OF_MONTH_MIN)}–${String(DAY_OF_MONTH_MAX)}`,
      );
    }
    return { ok: true, schedule: { kind, dayOfMonth: value.dayOfMonth, time } };
  }
  const days = value.daysBefore;
  if (!Array.isArray(days) || days.length === 0) {
    return fail("daysBefore", "提前天數至少一個");
  }
  if (days.length > DAYS_BEFORE_MAX_COUNT) {
    return fail(
      `daysBefore[${String(DAYS_BEFORE_MAX_COUNT)}]`,
      `提前天數最多 ${String(DAYS_BEFORE_MAX_COUNT)} 個`,
    );
  }
  const seen = new Set<number>();
  for (const [index, day] of days.entries()) {
    if (!isIntegerIn(day, DAYS_BEFORE_MIN, DAYS_BEFORE_MAX)) {
      return fail(
        `daysBefore[${String(index)}]`,
        `提前天數必須是 ${String(DAYS_BEFORE_MIN)}–${String(DAYS_BEFORE_MAX)} 的整數`,
      );
    }
    if (seen.has(day)) {
      return fail(`daysBefore[${String(index)}]`, "提前天數不能重複");
    }
    seen.add(day);
  }
  return { ok: true, schedule: { kind, daysBefore: [...seen], time } };
}

/** 一次命中:這個時點該寄,`at` 是寄送時點(租戶當地的那天 `time`),`localDate` 是那一天。 */
export interface ScheduleHit {
  readonly at: Date;
  /** 命中的當地日期 `YYYY-MM-DD`(排程工作組 `dedupeKey` 用) */
  readonly localDate: string;
  /** `days-before` 才有:這次是「前幾天」那一次 */
  readonly daysBefore?: number;
}

/** 判斷「這個時點該不該寄」的輸入。 */
export interface ScheduleCheck {
  /** 排程這次的到期時點(`ScheduledJobContext.scheduledFor`) */
  readonly scheduledFor: Date | number;
  /** 租戶時區(`ScheduledJobTenant.timezone`) */
  readonly timezone: string;
  /**
   * 日期:`days-before` = 目標日(到期日、繳費日、開放日…);`daily-overdue` = 逾期起算的那天
   * (隔天起每天寄);`monthly` 不用。
   */
  readonly date?: LocalDate;
}

const dayNumber = (date: LocalDate) =>
  Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY;

const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

function requireDate(schedule: NotificationSchedule, check: ScheduleCheck) {
  if (check.date === undefined) {
    throw new TypeError(`提醒時間 ${schedule.kind} 需要 date`);
  }
  return check.date;
}

/**
 * 「這個時點該不該寄」:寄送時點落在 `(scheduledFor − 15 分鐘, scheduledFor]` 就命中
 * (時間到了之後的第一次排程寄出;每個時點只會落在一次排程裡)。沒命中 → null。
 *
 * - 錯過的時點不補:改了時間之後,當天已經過了的新時點不會再落進之後的排程,舊時點也不再算。
 * - 同一時點只寄一次:排程工作用 `localDate`(與 `daysBefore`)組 `notify()` 的 `dedupeKey`。
 */
export function scheduleHitAt(
  schedule: NotificationSchedule,
  check: ScheduleCheck,
): ScheduleHit | null {
  const slot =
    typeof check.scheduledFor === "number"
      ? check.scheduledFor
      : check.scheduledFor.getTime();
  const [hour, minute] = schedule.time.split(":").map(Number) as [
    number,
    number,
  ];
  // 寄送時點的當地日期只可能是 slot 當天或(跨午夜時)前一刻的那天
  const candidates = [
    localDateOf(slot, check.timezone),
    localDateOf(slot - SLOT_MS + 1, check.timezone),
  ];
  for (const localDate of candidates) {
    const at = instantOfLocalTime(localDate, hour, minute, check.timezone);
    if (at > slot || at <= slot - SLOT_MS) {
      continue;
    }
    const hit = matchDate(schedule, check, localDate);
    if (hit !== null) {
      return { at: new Date(at), localDate: localDateText(localDate), ...hit };
    }
  }
  return null;
}

function matchDate(
  schedule: NotificationSchedule,
  check: ScheduleCheck,
  localDate: LocalDate,
): { daysBefore?: number } | null {
  if (schedule.kind === "monthly") {
    const day = Math.min(
      schedule.dayOfMonth,
      lastDayOfMonth(localDate.year, localDate.month),
    );
    return localDate.day === day ? {} : null;
  }
  const diff = dayNumber(requireDate(schedule, check)) - dayNumber(localDate);
  if (schedule.kind === "daily-overdue") {
    return diff < 0 ? {} : null;
  }
  return schedule.daysBefore.includes(diff) ? { daysBefore: diff } : null;
}
