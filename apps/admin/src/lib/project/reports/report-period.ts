import {
  type LocalDate,
  addLocalDays,
  addLocalMonths,
  localDateText,
  localDayRange,
  localMonthRange,
  parseLocalDate,
  toIso,
  weekdayOfLocalDate,
} from "@repo/domain/form";

/**
 * 輸出報表的期間(專案規格 11.1、18.4;正本 `docs/modules/project/reports.md`「期間」):
 * 選擇器給的是**租戶時區**的當地日期,換成起訖時點(迄不含)才交給 api(api 只收時點)。
 * 換算一律用 `@repo/domain/form` 的日曆與期間工具(`addLocalDays`、`addLocalMonths`、`localDayRange`、
 * `localMonthRange`;日期只有一種做法)。
 *
 * | 類型 | 起                 | 迄(不含)          |
 * | ---- | ------------------ | ------------------ |
 * | 日   | 當日 00:00         | 隔日 00:00         |
 * | 週   | **星期日** 00:00   | 下一個星期日 00:00 |
 * | 月   | 1 日 00:00         | 下個月 1 日 00:00  |
 *
 * 一週固定從星期日開始(與 `MonthCalendar` 同一規則);沒有自訂區間。
 */

/** 期間類型(與 api `report-range.ts` 的 `REPORT_PERIOD_KINDS` 同一組值)。 */
export const REPORT_PERIOD_KINDS = ["day", "week", "month"] as const;

export type ReportPeriodKind = (typeof REPORT_PERIOD_KINDS)[number];

/**
 * 選擇器的值:期間類型 + 那個期間的起點日期(`YYYY-MM-DD`;日 = 那一天、週 = 星期日、月 = 1 日)。
 * `date` 空字串 = 還沒選(畫面以「今天所在的期間」代入,見 `normalizePeriod`)。
 */
export interface ReportPeriodValue {
  kind: ReportPeriodKind;
  date: string;
}

/** 起訖時點(ISO;迄不含)。 */
export interface ReportPeriodRange {
  from: string;
  to: string;
}

const DAYS_PER_WEEK = 7;

const startDateOf = (kind: ReportPeriodKind, date: LocalDate): LocalDate => {
  if (kind === "week") return addLocalDays(date, -weekdayOfLocalDate(date));
  if (kind === "month") return { ...date, day: 1 };
  return date;
};

/** 任一天 → 它所在期間的起點(`YYYY-MM-DD`);不是日期 → 原樣回。 */
export const periodStartOf = (kind: ReportPeriodKind, text: string): string => {
  const date = parseLocalDate(text);
  return date === null ? text : localDateText(startDateOf(kind, date));
};

/** 週的起點(星期日)→ 那一週的星期六(`YYYY-MM-DD`)。 */
export const lastDayOfWeek = (sunday: string): string => {
  const date = parseLocalDate(sunday);
  return date === null
    ? sunday
    : localDateText(addLocalDays(date, DAYS_PER_WEEK - 1));
};

/**
 * 往前 / 往後幾個期間,回新期間的起點:[昨天] = `-1` 日、[上週] = `-1` 週、[上月] = `-1` 月。
 * 月一律從 1 日起算,不會有 3/31 − 1 個月溢出的問題。
 */
export const shiftPeriod = (
  kind: ReportPeriodKind,
  text: string,
  amount: number,
): string => {
  const date = parseLocalDate(text);
  if (date === null) return text;
  const start = startDateOf(kind, date);
  if (kind === "month") {
    return localDateText({ ...addLocalMonths(start, amount), day: 1 });
  }
  return localDateText(
    addLocalDays(start, amount * (kind === "week" ? DAYS_PER_WEEK : 1)),
  );
};

/** 把值整理成「期間起點」;還沒選日期的代入今天所在的期間。 */
export const normalizePeriod = (
  value: ReportPeriodValue,
  today: string,
): ReportPeriodValue => ({
  kind: value.kind,
  date: periodStartOf(
    value.kind,
    parseLocalDate(value.date) === null ? today : value.date,
  ),
});

/** 期間 → 起訖時點(租戶時區;迄不含)。日期不合法 → `null`。 */
export const reportPeriodRange = (
  value: ReportPeriodValue,
  timezone: string,
): ReportPeriodRange | null => {
  const date = parseLocalDate(value.date);
  if (date === null) return null;
  const start = startDateOf(value.kind, date);
  if (value.kind === "month") {
    const month = localMonthRange(start, timezone);
    return { from: toIso(month.from), to: toIso(month.to) };
  }
  const last =
    value.kind === "week" ? addLocalDays(start, DAYS_PER_WEEK - 1) : start;
  const range = localDayRange(start, last, timezone);
  return { from: toIso(range.from), to: toIso(range.to) };
};
