import {
  type InstantRange,
  type LocalDate,
  addLocalDays,
  formatTemporal,
  localDateOf,
  localDateText,
  localDayRange,
  localMonthOf,
  localMonthRange,
  localMonthText,
  parseLocalDate,
  parseLocalMonth,
  startOfLocalDay,
  startOfLocalDayOf,
} from "@repo/domain/form";

import { validationError } from "./schedule-error";

/**
 * 排班的日期換算(正本 `docs/modules/project/schedule.md`「日期與期間」):
 *
 * - **存值與 api 的日期是時點**:那天租戶時區 00:00(`date`);期間是半開的時點區間 `[from, to)`
 * - **記憶體裡的日期鍵**:規則運算(星期幾、連續天數、同一天)用租戶時區的 `YYYY-MM-DD` / `YYYY-MM`,
 *   由這裡從時點推出來(和表單引擎「日期互比換成當地日期再算」同一套)
 * - 日曆運算一律用 `@repo/domain/form`,這裡只把「時點 ↔ 日期鍵」與「輸入正規化」收成一處
 */

/** 時點 → 租戶時區的日期鍵 `YYYY-MM-DD`。 */
export function dateKeyOf(at: Date | number, timezone: string): string {
  return localDateText(
    localDateOf(typeof at === "number" ? at : at.getTime(), timezone),
  );
}

/** 時點 → 租戶時區的時刻 `HH:mm`(隔天 00:00 印 `00:00`;通知內文、稽核用)。 */
export function clockTextOf(at: Date | number, timezone: string): string {
  return formatTemporal(at, { type: "datetime", timezone }).slice(11);
}

/** 時點 → 那天租戶時區 00:00(日期的存值)。 */
export function dayStartOf(at: Date | number, timezone: string): Date {
  return new Date(
    startOfLocalDayOf(typeof at === "number" ? at : at.getTime(), timezone),
  );
}

/** `YYYY-MM-DD` → `LocalDate`;呼叫端已驗過格式,不合法是程式錯誤(`RangeError`)。 */
export function localDateOfKey(key: string): LocalDate {
  const parsed = parseLocalDate(key);
  if (parsed === null) {
    throw new RangeError(`invalid date key: ${key}`);
  }
  return parsed;
}

/** 日期鍵 → 那天租戶時區 00:00 的時點;日期鍵不合法 → `RangeError`(呼叫端已驗過)。 */
export function instantOfKey(key: string, timezone: string): Date {
  return new Date(startOfLocalDay(localDateOfKey(key), timezone));
}

/** 日期鍵所在的月份鍵 `YYYY-MM`。 */
export function monthKeyOf(key: string): string {
  const { year, month } = localDateOfKey(key);
  return localMonthText({ year, month });
}

/** 日期鍵是不是在這個月份鍵(`YYYY-MM`)裡。 */
export function isDateKeyInMonth(key: string, month: string): boolean {
  return monthKeyOf(key) === month;
}

/**
 * 日期鍵的「M/D」(規則訊息用;走 `formatTemporal` 的 `monthDay`)。日期鍵本身就是當地的那一天、
 * 和時區無關,所以用 UTC 當中性的換算框架(那天 UTC 00:00 印回 UTC 的月日),不必知道租戶時區。
 */
export function monthDayOfKey(key: string): string {
  return formatTemporal(instantOfKey(key, "UTC"), {
    type: "monthDay",
    timezone: "UTC",
  });
}

/** 日期鍵加減天數(`addLocalDays`)。 */
export function shiftDateKey(key: string, days: number): string {
  return localDateText(addLocalDays(localDateOfKey(key), days));
}

/** 日期鍵期間(含頭尾)→ 時點區間 `[from 00:00, to 隔天 00:00)`;不合法 → `VALIDATION_FAILED`。 */
export function dayKeyRange(
  from: string,
  to: string,
  timezone: string,
): InstantRange {
  const first = parseLocalDate(from);
  const last = parseLocalDate(to);
  if (first === null || last === null) {
    throw validationError(`invalid date range: ${from}–${to}`, ["from", "to"]);
  }
  return localDayRange(first, last, timezone);
}

/** 時點所在那天(租戶時區)→ 時點區間 `[那天 00:00, 隔天 00:00)`(23 / 25 小時的日子也對)。 */
export function dayRangeOf(at: Date | number, timezone: string): InstantRange {
  const day = localDateOf(typeof at === "number" ? at : at.getTime(), timezone);
  return localDayRange(day, day, timezone);
}

/**
 * 時點所在那天(租戶時區)的前一天到後一天 → 時點區間 `[前一天 00:00, 後一天的隔天 00:00)`:
 * 「這張卡可能屬於哪一班」的範圍([改對應排班]、補打卡的「對應排班」下拉與送出檢查同一條)。
 */
export function aroundDayRangeOf(
  at: Date | number,
  timezone: string,
): InstantRange {
  const day = localDateOf(typeof at === "number" ? at : at.getTime(), timezone);
  return localDayRange(addLocalDays(day, -1), addLocalDays(day, 1), timezone);
}

/** 月份鍵 → 時點區間 `[月初 00:00, 下月初 00:00)`;月份鍵不合法 → `RangeError`(呼叫端已驗過)。 */
export function monthKeyRange(month: string, timezone: string): InstantRange {
  const parsed = parseLocalMonth(month);
  if (parsed === null) {
    throw new RangeError(`invalid month key: ${month}`);
  }
  return localMonthRange(parsed, timezone);
}

/** 時點區間的查詢條件 `{ $gte: from, $lt: to }`。 */
export function instantRangeFilter(range: InstantRange): {
  $gte: Date;
  $lt: Date;
} {
  return { $gte: new Date(range.from), $lt: new Date(range.to) };
}

/** 時點區間裡每一天的日期鍵(`[from, to)`;`from` 不是 00:00 也從那天算起)。 */
export function dateKeysOfRange(
  range: InstantRange,
  timezone: string,
): string[] {
  if (range.to <= range.from) {
    return [];
  }
  const keys: string[] = [];
  const last = dateKeyOf(range.to - 1, timezone);
  for (
    let key = dateKeyOf(range.from, timezone);
    key <= last;
    key = shiftDateKey(key, 1)
  ) {
    keys.push(key);
  }
  return keys;
}

/**
 * 輸入的日期(時點)→ 那天租戶時區 00:00:admin 送的就是 00:00;送了當天其他時刻也歸到同一天。
 * 不是時點 → `VALIDATION_FAILED`(欄位 `field`)。
 */
export function normalizedDay(
  value: Date,
  timezone: string,
  field: string,
): Date {
  const instant = value.getTime();
  if (!Number.isFinite(instant)) {
    throw validationError(`${field} must be an instant`, [field]);
  }
  return dayStartOf(instant, timezone);
}

/**
 * 輸入的期間 `[from, to)`(兩個時點,admin 送的是租戶時區的 00:00)→ 兩端各正規化成那天 00:00。
 * 只給一個、不是時點、迄不晚於起 → `VALIDATION_FAILED`(欄位 `from`、`to`)。
 */
export function normalizedDayRange(
  from: Date | null | undefined,
  to: Date | null | undefined,
  timezone: string,
): InstantRange {
  const start = from?.getTime() ?? Number.NaN;
  const end = to?.getTime() ?? Number.NaN;
  const range =
    Number.isFinite(start) && Number.isFinite(end)
      ? {
          from: startOfLocalDayOf(start, timezone),
          to: startOfLocalDayOf(end, timezone),
        }
      : null;
  if (range === null || range.to <= range.from) {
    throw validationError("from / to must be instants with from < to", [
      "from",
      "to",
    ]);
  }
  return range;
}

const notWholeMonth = () =>
  validationError("from / to must be one whole month in the tenant timezone", [
    "from",
    "to",
  ]);

/**
 * 月份查詢的 `from` / `to`:要剛好是租戶時區某個月的 `[月初 00:00, 下月初 00:00)`,回那個月的月份鍵;
 * 兩個都缺席 → null(呼叫端用預設月份);只給一個、或不是整個月 → `VALIDATION_FAILED`(欄位 `from`、`to`)。
 */
export function monthOfWholeMonthRange(
  input: { from?: Date | null; to?: Date | null } | null | undefined,
  timezone: string,
): string | null {
  const from = input?.from ?? null;
  const to = input?.to ?? null;
  if (from === null && to === null) {
    return null;
  }
  if (from === null || to === null || !Number.isFinite(from.getTime())) {
    throw notWholeMonth();
  }
  const month = localMonthOf(from.getTime(), timezone);
  const range = localMonthRange(month, timezone);
  if (range.from !== from.getTime() || range.to !== to.getTime()) {
    throw notWholeMonth();
  }
  return localMonthText(month);
}

/**
 * 規則違反的期間(規則運算的日期鍵起訖,含頭尾)→ api 輸出的半開時點區間
 * `[起那天 00:00, 迄那天的隔天 00:00)`(和自動排班範圍、月份查詢同一個語意);沒有的那端 = null。
 * 檢核項目、存排班 / 畫休被擋時的 `violations`、畫休違規清單都用這個。
 */
export function violationPeriodOf(
  detail: { from?: string; to?: string } | undefined,
  timezone: string,
): { from: Date | null; to: Date | null } {
  const from = detail?.from;
  const to = detail?.to;
  return {
    from: from === undefined ? null : instantOfKey(from, timezone),
    to: to === undefined ? null : instantOfKey(shiftDateKey(to, 1), timezone),
  };
}
