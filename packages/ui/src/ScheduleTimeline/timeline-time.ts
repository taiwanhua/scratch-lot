import { clockIn, dayStartIn, nextDayStartIn } from "../DatePicker/zoned-day";
import type {
  ScheduleTimelinePoint,
  ScheduleTimelineTime,
} from "./schedule-timeline-types";

/**
 * 時間軸的時間換算(純函式):時點 ↔「某一天的第幾分鐘」。時間軸固定 00:00–24:00,
 * 一天以 `timezone`(IANA,元件的 `timezone` prop)的 00:00 起算,沒給時用瀏覽器時區;
 * 跨午夜的東西由 `clipToDay` 切成兩天各一段。
 * 「第幾分鐘」是從當天 00:00 起經過的時間:有夏令時間的時區在切換日(23 或 25 小時)上,
 * 切換後的長條與刻度差一小時、25 小時那天最後一小時被裁掉(已知限制;租戶時區沒有夏令時間時不會發生)。
 */

export const MINUTES_PER_DAY = 24 * 60;
/** 沒有資料時,進入畫面捲到 08:00。 */
export const DEFAULT_SCROLL_MINUTE = 8 * 60;
/** 自動捲動停在最早的長條或容器的前 1 小時。 */
const SCROLL_LEAD_MINUTES = 60;

const MS_PER_MINUTE = 60_000;

export const toMs = (time: ScheduleTimelineTime): number =>
  typeof time === "number" ? time : time.getTime();

/** 那一天 00:00 的 epoch 毫秒(`YYYY-MM-DD`;沒給時區 = 瀏覽器時區)。 */
export const dayStartMs = (date: string, timezone?: string): number =>
  dayStartIn(date, timezone);

/** 一段時間落在某一天的那一段(分鐘,0–1440)。 */
export interface DaySpan {
  startMinute: number;
  endMinute: number;
  /** 從前一天接續過來(當天從 00:00 畫起,標「前日 →」) */
  fromPrevDay: boolean;
  /** 延續到下一天(當天畫到 24:00,標「→ 次日」) */
  toNextDay: boolean;
}

/** 把一段時間裁到某一天;沒有落在這一天時回 `null`。 */
export const clipToDay = (
  start: ScheduleTimelineTime,
  end: ScheduleTimelineTime,
  date: string,
  timezone?: string,
): DaySpan | null => {
  const dayStart = dayStartMs(date, timezone);
  const dayEnd = nextDayStartIn(date, timezone);
  const startMs = toMs(start);
  const endMs = toMs(end);
  if (endMs <= dayStart || startMs >= dayEnd || endMs <= startMs) {
    return null;
  }
  return {
    startMinute: Math.max(0, (startMs - dayStart) / MS_PER_MINUTE),
    endMinute: Math.min(MINUTES_PER_DAY, (endMs - dayStart) / MS_PER_MINUTE),
    fromPrevDay: startMs < dayStart,
    toNextDay: endMs > dayEnd,
  };
};

const pad2 = (value: number) => String(value).padStart(2, "0");

/** 第幾分鐘 →「HH:mm」(1440 寫成 24:00)。 */
export const formatMinute = (minute: number): string => {
  const whole = Math.floor(minute);
  return `${pad2(Math.floor(whole / 60))}:${pad2(whole % 60)}`;
};

/** 某一天第幾分鐘所在的那一小時格,當成回呼帶出的點。 */
export const pointAt = (
  date: string,
  minute: number,
  timezone?: string,
): ScheduleTimelinePoint => {
  const hourStart = Math.min(Math.max(Math.floor(minute / 60), 0), 23) * 60;
  return {
    date,
    time: formatMinute(hourStart),
    at: new Date(dayStartMs(date, timezone) + hourStart * MS_PER_MINUTE),
  };
};

/**
 * 進入畫面(或切換日期 / 週)時要捲到第幾分鐘:顯示範圍內最早的長條或容器的前 1 小時
 * (不早於 00:00);沒有資料時 08:00。`startMinutes` 是各長條 / 容器落在顯示日期內那一段的開始。
 */
export const initialScrollMinute = (startMinutes: readonly number[]): number =>
  startMinutes.length === 0
    ? DEFAULT_SCROLL_MINUTE
    : Math.max(0, Math.min(...startMinutes) - SCROLL_LEAD_MINUTES);

/** 時點 →「HH:mm」(沒給時區 = 瀏覽器時區)。 */
export const formatClock = (
  time: ScheduleTimelineTime,
  timezone?: string,
): string => clockIn(toMs(time), timezone);

/** 「HH:mm–HH:mm」:長條 / 容器沒給無障礙名稱時的預設。 */
export const formatTimeRange = (
  start: ScheduleTimelineTime,
  end: ScheduleTimelineTime,
  timezone?: string,
): string => `${formatClock(start, timezone)}–${formatClock(end, timezone)}`;
