import dayjs from "dayjs";

/** 月份字串格式:`YYYY-MM`(對外的月份值,與 `DatePicker` 的 `YYYY-MM-DD` 同一族)。 */
const MONTH_FORMAT = "YYYY-MM";
/** 日期字串格式:`YYYY-MM-DD`。 */
const DATE_FORMAT = "YYYY-MM-DD";
const DAYS_IN_WEEK = 7;

/** `YYYY-MM-DD` 字串依字典序即依日期序。 */
const byDate = (a: string, b: string) => a.localeCompare(b);

/** 月曆上的一格。`inMonth = false` 是本月前後補齊整週的上 / 下個月日期(只顯示、不能選)。 */
export interface CalendarDay {
  /** `YYYY-MM-DD` */
  date: string;
  /** 日(1–31),畫在格子左上角 */
  day: number;
  inMonth: boolean;
}

/** 整週勾選框的狀態:沒選 / 部分選(半選)/ 全選 / 整週沒有可選的日子(停用)。 */
export type WeekSelectionState = "none" | "some" | "all" | "disabled";

const parseMonth = (month: string) => dayjs(`${month}-01`);

/**
 * 依月份排出整週的格子,**一週固定從星期日開始**。
 * 第一週往前補上個月、最後一週往後補下個月,每週都是 7 格;週數依月份而定(4–6 週)。
 */
export const buildMonthWeeks = (month: string): CalendarDay[][] => {
  const first = parseMonth(month);
  const start = first.subtract(first.day(), "day");
  const last = first.endOf("month");
  const end = last.add(DAYS_IN_WEEK - 1 - last.day(), "day");
  const weeks: CalendarDay[][] = [];
  for (
    let cursor = start;
    !cursor.isAfter(end, "day");
    cursor = cursor.add(DAYS_IN_WEEK, "day")
  ) {
    weeks.push(
      Array.from({ length: DAYS_IN_WEEK }, (_, offset) => {
        const date = cursor.add(offset, "day");
        return {
          date: date.format(DATE_FORMAT),
          day: date.date(),
          inMonth: date.month() === first.month(),
        };
      }),
    );
  }
  return weeks;
};

/** 上 / 下個月(`delta = -1 / 1`),回傳 `YYYY-MM`。 */
export const shiftMonth = (month: string, delta: number): string =>
  parseMonth(month).add(delta, "month").format(MONTH_FORMAT);

/** 表頭的年月(數字);文字由使用處的 `formatMonthTitle` 組。 */
export const monthParts = (month: string) => {
  const parsed = parseMonth(month);
  return { year: parsed.year(), month: parsed.month() + 1 };
};

/** 一週裡「可選」的日期:本月、且使用處沒有停用。 */
export const selectableDatesOf = (
  week: readonly CalendarDay[],
  isDisabled: (date: string) => boolean,
): string[] =>
  week.filter((day) => day.inMonth && !isDisabled(day.date)).map((d) => d.date);

/** 整週勾選框該顯示的狀態。 */
export const weekSelectionState = (
  selectable: readonly string[],
  selected: ReadonlySet<string>,
): WeekSelectionState => {
  if (selectable.length === 0) return "disabled";
  const count = selectable.filter((date) => selected.has(date)).length;
  if (count === 0) return "none";
  return count === selectable.length ? "all" : "some";
};

/**
 * 按整週勾選框後的新選取:該週可選的日子都已選 → 全部取消;否則 → 全部選取(跳過停用日)。
 * 其他週的選取原樣保留,順序依日期排序,呼叫端拿到的值穩定。
 */
export const toggleWeekSelection = (
  current: readonly string[],
  selectable: readonly string[],
): string[] => {
  const selected = new Set(current);
  const allSelected = selectable.every((date) => selected.has(date));
  for (const date of selectable) {
    if (allSelected) selected.delete(date);
    else selected.add(date);
  }
  return [...selected].toSorted(byDate);
};

/** 多選模式點一天:切換那一天的選取。 */
export const toggleDaySelection = (
  current: readonly string[],
  date: string,
): string[] =>
  current.includes(date)
    ? current.filter((d) => d !== date)
    : [...current, date].toSorted(byDate);
