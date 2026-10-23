import {
  type LocalDate,
  type LocalMonth,
  addLocalDays,
  addLocalMonths,
  clampedDateOfMonth,
  localDateDiff,
  localDateText,
  localMonthText,
  parseLocalDate,
  parseLocalMonth,
} from "@repo/domain/form";

/**
 * 畫休開放期間(規格 14.2「畫休開放期間」:每月 N 日至 M 日,登記**下個月**的畫休)。
 * 純函式:日期一律是租戶當地的 `YYYY-MM-DD` / `YYYY-MM` 字串(記憶體裡的日期鍵 / 月份鍵;
 * 存值與 api 輸出是時點,由 service 換算),日曆運算用 `@repo/domain/form`。
 *
 * - 某個月(目標月)的開放期間 = 前一個月的 N 日至 M 日;那個月沒有這一天用月底(例:31 日 → 2 月 28 / 29 日)
 * - 狀態:今天早於開始 = 還沒開始;開始到結束(含頭尾)= 開放中;晚於結束 = 已截止
 * - 本人只能在開放中登記 / 刪除目標月的畫休;代改不受開放期間限制,但截止後原因必填
 */

export interface DayOffWindowValue {
  startDay: number;
  endDay: number;
}

export type DayOffWindowState = "before" | "open" | "closed";

export interface DayOffWindow {
  /** 目標月 `YYYY-MM`(在這段期間登記的是這個月的畫休) */
  month: string;
  /** 開始日 `YYYY-MM-DD`(目標月的前一個月) */
  startDate: string;
  /** 截止日 `YYYY-MM-DD`(含) */
  endDate: string;
}

/** `YYYY-MM` → `LocalMonth`;呼叫端已驗過格式,不合法是程式錯誤。 */
function monthOf(month: string): LocalMonth {
  const parsed = parseLocalMonth(month);
  if (parsed === null) {
    throw new RangeError(`invalid month: ${month}`);
  }
  return parsed;
}

/** `YYYY-MM-DD` → `LocalDate`;同上。 */
function dateOf(date: string): LocalDate {
  const parsed = parseLocalDate(date);
  if (parsed === null) {
    throw new RangeError(`invalid date: ${date}`);
  }
  return parsed;
}

/**
 * `YYYY-MM-DD` 加減幾天。畫休這一區已改用 `@repo/domain/form` 的 `addLocalDays`;
 * 這個轉接只留給排班檢核 / 自動排班(下一張票換成時點時一起換掉)。
 */
export function shiftDate(date: string, amount: number): string {
  return localDateText(addLocalDays(dateOf(date), amount));
}

/** 目標月的開放期間(前一個月的 N 日至 M 日,超過月底用月底)。 */
export function dayOffWindowFor(
  month: string,
  value: DayOffWindowValue,
): DayOffWindow {
  const previous = addLocalMonths(monthOf(month), -1);
  return {
    month,
    startDate: localDateText(clampedDateOfMonth(previous, value.startDay)),
    endDate: localDateText(clampedDateOfMonth(previous, value.endDay)),
  };
}

/** 今天落在開放期間的哪一段。 */
export function dayOffWindowState(
  window: DayOffWindow,
  today: string,
): DayOffWindowState {
  if (today < window.startDate) {
    return "before";
  }
  return today <= window.endDate ? "open" : "closed";
}

/** 開放中還剩幾天(含今天);其他狀態為 0。 */
export function dayOffWindowDaysLeft(
  window: DayOffWindow,
  today: string,
): number {
  return dayOffWindowState(window, today) === "open"
    ? localDateDiff(dateOf(today), dateOf(window.endDate)) + 1
    : 0;
}

/** 今天在登記哪個月:下個月(`YYYY-MM`)。 */
export function dayOffTargetMonth(today: string): string {
  const { year, month } = dateOf(today);
  return localMonthText(addLocalMonths({ year, month }, 1));
}

const DEFAULT_WINDOW_VALUE: DayOffWindowValue = { startDay: 15, endDay: 25 };

/**
 * 規則「畫休開放期間」的值(登記檢查與開放 / 截止通知共用同一個判斷):只看值、不看開關 ——
 * 這條規則沒有等級,一律生效;值不完整時用程式預設 15–25 日。
 */
export function dayOffWindowValueOf(
  setting: { value: Record<string, unknown> } | undefined,
): DayOffWindowValue {
  const startDay = Number(setting?.value.startDay);
  const endDay = Number(setting?.value.endDay);
  return Number.isInteger(startDay) && Number.isInteger(endDay)
    ? { startDay, endDay }
    : DEFAULT_WINDOW_VALUE;
}
