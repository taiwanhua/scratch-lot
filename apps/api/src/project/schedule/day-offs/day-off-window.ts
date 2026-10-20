/**
 * 畫休開放期間(規格 14.2「畫休開放期間」:每月 N 日至 M 日,登記**下個月**的畫休)。
 * 純函式:日期一律是租戶當地的 `YYYY-MM-DD` / `YYYY-MM` 字串。
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

const pad = (value: number) => String(value).padStart(2, "0");

const monthText = (year: number, month: number) =>
  `${String(year)}-${pad(month)}`;

function monthPartsOf(month: string): { year: number; month: number } {
  const [year = 0, value = 0] = month.split("-").map(Number);
  return { year, month: value };
}

/** `YYYY-MM` 加減幾個月。 */
export function shiftMonth(month: string, amount: number): string {
  const parts = monthPartsOf(month);
  const index = parts.year * 12 + (parts.month - 1) + amount;
  return monthText(Math.floor(index / 12), (index % 12) + 1);
}

/** 那個月有幾天。 */
export function daysInMonth(month: string): number {
  const parts = monthPartsOf(month);
  return new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
}

/** `YYYY-MM-DD` 加減幾天。 */
export function shiftDate(date: string, amount: number): string {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return `${monthText(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function utcOf(date: string): number {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** 兩個日期相差幾天(`to − from`)。 */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / 86_400_000);
}

/** 某個月每一天(`YYYY-MM-DD`)。 */
export function datesOfMonth(month: string): string[] {
  return Array.from(
    { length: daysInMonth(month) },
    (_, index) => `${month}-${pad(index + 1)}`,
  );
}

/** 目標月的開放期間(前一個月的 N 日至 M 日,超過月底用月底)。 */
export function dayOffWindowFor(
  month: string,
  value: DayOffWindowValue,
): DayOffWindow {
  const previous = shiftMonth(month, -1);
  const last = daysInMonth(previous);
  return {
    month,
    startDate: `${previous}-${pad(Math.min(value.startDay, last))}`,
    endDate: `${previous}-${pad(Math.min(value.endDay, last))}`,
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
    ? daysBetween(today, window.endDate) + 1
    : 0;
}

/** 今天在登記哪個月:下個月(`YYYY-MM`)。 */
export function dayOffTargetMonth(today: string): string {
  return shiftMonth(today.slice(0, 7), 1);
}
