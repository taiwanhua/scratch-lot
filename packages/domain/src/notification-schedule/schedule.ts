/**
 * 通知的「可調時間」(提醒時間)的格式正本:通知類型可選填宣告一種寫法與預設值,
 * 租戶在通知設定頁調整「提前幾天、幾點寄」。api(登記檢查、存檔驗證)與 admin(編輯框)共用,
 * 範圍只有這一份(STRUCT-07)。日期本身(例:到期日)不在這裡,由排程工作從各自的資料帶進來;
 * 時間一律以租戶時區計。語意見 `docs/modules/notification-settings.md`「可調時間」。
 */
import { isHhMm, minutesOfHhMm } from "../form/temporal";

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
/** 寄送時間的格子(分鐘),也是排程的間隔(編輯畫面 `TimePicker` 的 `minutesStep`)。 */
export const SCHEDULE_STEP_MINUTES = 15;


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
  const minutes = isHhMm(value) ? minutesOfHhMm(value) : null;
  return minutes !== null && minutes % SCHEDULE_STEP_MINUTES === 0;
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
