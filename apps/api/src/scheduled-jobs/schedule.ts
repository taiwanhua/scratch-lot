import {
  addLocalCalendar,
  instantOfLocalTime,
  localDateOf,
  startOfLocalDay,
} from "@repo/domain/form";

/**
 * 排程頻率:`"15m"`(每 15 分鐘)、`"1h"`(每小時)、`"daily@HH:mm"`(每天租戶當地 HH:mm,24 小時制)。
 * Cloud Scheduler 每 15 分鐘呼叫一次,所以沒有更細的頻率。
 */
export type ScheduleEvery = "15m" | "1h" | `daily@${string}`;

/** 解析後的頻率。 */
export type ParsedSchedule =
  | { kind: "interval"; intervalMs: number }
  | { kind: "daily"; hour: number; minute: number };

const MS_PER_MINUTE = 60_000;
const INTERVALS: Record<string, number> = {
  "15m": 15 * MS_PER_MINUTE,
  "1h": 60 * MS_PER_MINUTE,
};
const DAILY = /^daily@([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * 每日工作的補跑窗:租戶當地 HH:mm 過後這段時間內的呼叫都算到期(錯過幾次 Scheduler 呼叫仍會補跑一次),
 * 超過就等下一天。沒有這個窗,新部署在 07:00 收到第一次呼叫時會把「昨天 08:00」補跑,一小時後又跑今天的。
 */
export const DAILY_CATCH_UP_MS = 6 * 60 * MS_PER_MINUTE;

/** 不認得的頻率回 null(登記時據此拒絕)。 */
export function parseSchedule(every: string): ParsedSchedule | null {
  const intervalMs = INTERVALS[every];
  if (intervalMs !== undefined) {
    return { kind: "interval", intervalMs };
  }
  const match = DAILY.exec(every);
  if (!match) {
    return null;
  }
  return { kind: "daily", hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * 間隔工作在 `now` 所在區間的起點(UTC 對齊:`15m` 對齊 :00 / :15 / :30 / :45,`1h` 對齊整點)。
 * 同一區間內的每次呼叫都得到同一個時點,錯過的區間不補。
 */
export function intervalSlotOf(intervalMs: number, now: number): number {
  return Math.floor(now / intervalMs) * intervalMs;
}

/**
 * 每日工作在某時區到期的時點:最近一次(≤ `now`)的當地 HH:mm;已超過補跑窗 → null(今天不跑或已錯過)。
 * 夏令時間切換日不存在的時刻落在切換後,重複的時刻取較早的一個(`instantOfLocalTime`)。
 */
export function dailySlotOf(
  schedule: { hour: number; minute: number },
  now: number,
  timezone: string,
): number | null {
  const today = localDateOf(now, timezone);
  let slot = instantOfLocalTime(
    today,
    schedule.hour,
    schedule.minute,
    timezone,
  );
  if (slot > now) {
    const yesterday = localDateOf(
      addLocalCalendar(startOfLocalDay(today, timezone), -1, "days", timezone),
      timezone,
    );
    slot = instantOfLocalTime(
      yesterday,
      schedule.hour,
      schedule.minute,
      timezone,
    );
  }
  return now - slot < DAILY_CATCH_UP_MS ? slot : null;
}
