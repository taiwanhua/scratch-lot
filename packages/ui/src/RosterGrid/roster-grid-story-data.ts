import type { RosterDate } from "./roster-grid-types";

/** stories 與測試共用的假資料(班表示範:人 × 日期)。 */
export interface DemoStaff {
  id: string;
  name: string;
  role: string;
  /** 本月已排時數(統計欄) */
  hours: number;
  /** 本月班數(統計欄) */
  shifts: number;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;
const NAMES = ["王小明", "李小華", "陳大文", "林美麗", "張小芳", "黃志強"];
/** 2026-10-01 是星期四 */
const FIRST_WEEKDAY = 4;

/** 示範的店休日(每週二) */
export const DEMO_CLOSED_DAYS: readonly number[] = [6, 13, 20, 27];

/** 2026-10 起連續 `count` 天;`closed` 裡的日子是店休(停用)。 */
export const demoDates = (
  count: number,
  closed: readonly number[] = DEMO_CLOSED_DAYS,
): RosterDate[] =>
  Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const weekday = WEEKDAYS[(index + FIRST_WEEKDAY) % 7] ?? "";
    const disabled = closed.includes(day);
    return {
      date,
      header: `10/${String(day)} ${weekday}${disabled ? " · 店休" : ""}`,
      disabled,
    };
  });

const nameOf = (index: number) => {
  const base = NAMES[index % NAMES.length] ?? "";
  return index < NAMES.length ? base : `${base} ${String(index + 1)}`;
};

export const demoStaff = (count: number): DemoStaff[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `s${String(index + 1)}`,
    name: nameOf(index),
    role: index === 0 ? "店長" : "店員",
    hours: 120 + (index % 5) * 8,
    shifts: 15 + (index % 4),
  }));

/** 有沒有排班:依人員與日期決定(穩定的假資料;店休日沒有)。 */
export const hasDemoShift = (staffIndex: number, day: number) =>
  !DEMO_CLOSED_DAYS.includes(day) && (staffIndex * 3 + day) % 4 !== 0;
