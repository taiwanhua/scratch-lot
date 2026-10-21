import {
  type LocalDate,
  addLocalCalendar,
  instantOfLocalTime,
  localDateOf,
  localDateText,
  startOfLocalDay,
} from "@repo/domain/form";
import type { NotificationSchedule } from "@repo/domain/notification-schedule";

import { DAILY_CATCH_UP_MS } from "../scheduled-jobs/schedule";

/**
 * 排程用的「這個時點該不該寄」(`docs/modules/notification-settings.md`「排程接口」)。
 * 提醒時間的格式、範圍與驗證正本在 `@repo/domain/notification-schedule`。
 */
const MS_PER_DAY = 24 * 60 * 60_000;

/**
 * 補寄窗(同排程工作的 `DAILY_CATCH_UP_MS`,6 小時):排程漏跑(停機、呼叫失敗)時,
 * 6 小時內最近一個應寄時點還沒寄就補寄;超過就放棄,免得新部署把昨天的補寄出去。
 */
export const SCHEDULE_CATCH_UP_MS = DAILY_CATCH_UP_MS;

/**
 * 一次命中:這個時點該寄。`at` 是應寄時點(租戶當地那天的 `time`),`localDate` 是那一天;
 * `occurrence` 是這個時點的識別(`YYYY-MM-DD`,`days-before` 再加 `#d<天數>`),排程工作組進
 * `notify()` 的 `dedupeKey` —— 同一個時點不管被叫到幾次(準時或補寄)都只寄一次。
 */
export interface ScheduleHit {
  readonly at: Date;
  /** 命中的當地日期 `YYYY-MM-DD` */
  readonly localDate: string;
  /** `days-before` 才有:這次是「前幾天」那一次 */
  readonly daysBefore?: number;
  /** 這個時點的識別,組 `dedupeKey` 用 */
  readonly occurrence: string;
}

/** 判斷「這個時點該不該寄」的輸入。 */
export interface ScheduleCheck {
  /** 排程這次的到期時點(`ScheduledJobContext.scheduledFor`) */
  readonly scheduledFor: Date | number;
  /** 租戶時區(`ScheduledJobTenant.timezone`) */
  readonly timezone: string;
  /**
   * 日期:`days-before` = 目標日(例:到期日);`daily-overdue` = 逾期起算的那天
   * (隔天起每天寄);`monthly` 不用。
   */
  readonly date?: LocalDate;
  /**
   * 這個租戶這個類型提醒時間的最後修改時間(`EffectiveSchedule.modifiedAt`):
   * 早於它的時點不補寄(改了時間之後,當天已經過了的新時點不補)。沒改過 = null / 不給。
   */
  readonly modifiedAt?: Date | number | null;
}

const toMs = (value: Date | number) =>
  typeof value === "number" ? value : value.getTime();

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
 * 「這個時點該不該寄」:取 `(scheduledFor − 6 小時, scheduledFor]` 內**最近一個**應寄時點
 * (準時的那一次,或排程漏跑時補寄);沒有 → null。
 *
 * - 補寄窗 6 小時(`SCHEDULE_CATCH_UP_MS`),超過就放棄。
 * - 最近的應寄時點早於 `modifiedAt`(提醒時間的最後修改時間)→ 不寄:改了時間之後,
 *   當天已經過了的新時點不補,舊時點也不再算。
 * - 同一時點只寄一次:回傳的 `occurrence` 由排程工作組進 `dedupeKey`,之後的排程再叫到同一時點
 *   會回同一個 `occurrence`,由 `notify()` 的去重擋掉。
 */
export function scheduleHitAt(
  schedule: NotificationSchedule,
  check: ScheduleCheck,
): ScheduleHit | null {
  const slot = toMs(check.scheduledFor);
  const [hour, minute] = schedule.time.split(":").map(Number) as [
    number,
    number,
  ];
  // 窗只有 6 小時:應寄時點的當地日期只可能是 slot 當天或前一天;由近到遠找第一個符合的
  const today = localDateOf(slot, check.timezone);
  const yesterday = localDateOf(
    addLocalCalendar(
      startOfLocalDay(today, check.timezone),
      -1,
      "days",
      check.timezone,
    ),
    check.timezone,
  );
  for (const localDate of [today, yesterday]) {
    const at = instantOfLocalTime(localDate, hour, minute, check.timezone);
    if (at > slot || slot - at >= SCHEDULE_CATCH_UP_MS) {
      continue;
    }
    const hit = matchDate(schedule, check, localDate);
    if (hit === null) {
      continue;
    }
    const modifiedAt =
      check.modifiedAt === undefined || check.modifiedAt === null
        ? null
        : toMs(check.modifiedAt);
    if (modifiedAt !== null && at < modifiedAt) {
      return null;
    }
    const dateText = localDateText(localDate);
    return {
      at: new Date(at),
      localDate: dateText,
      ...hit,
      occurrence:
        hit.daysBefore === undefined
          ? dateText
          : `${dateText}#d${String(hit.daysBefore)}`,
    };
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
