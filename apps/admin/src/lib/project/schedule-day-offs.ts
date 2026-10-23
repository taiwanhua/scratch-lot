import type { TagTone } from "@repo/ui/tag";

/**
 * 畫休畫面共用的換算(我的畫休 SC-02、畫休總覽 SC-06;規格 14.5、14.6)。純函式,文案在呼叫端組。
 */

/** 違反的形狀(GraphQL `ScheduleDayOffViolation` 用得到的欄位)。 */
export interface DayOffViolationLike {
  key: string;
  level: string;
  dates: readonly string[];
}

export type DayOffBandLevel = "limit" | "reminder";

/**
 * 同日畫休人數「2/2」的顏色:未滿灰、滿了橘、超過紅(規格 14.5、14.6)。
 * 規則關掉(上限 null)一律灰。
 */
export const dayOffCountTone = (
  count: number,
  limit: number | null,
): TagTone => {
  if (limit === null || count < limit) {
    return "grey";
  }
  return count === limit ? "warning" : "error";
};

/** 涉及那天的違反(當天詳細的「涉及的規則」)。 */
export const violationsOn = <T extends DayOffViolationLike>(
  violations: readonly T[],
  date: string,
): T[] => violations.filter((violation) => violation.dates.includes(date));

/** 那天底部的色帶:涉及那天的違反裡最嚴重的等級(紅 = 限制、橘 = 提醒);沒有回 null。 */
export const dayOffBandOf = (
  violations: readonly DayOffViolationLike[],
  date: string,
): DayOffBandLevel | null => {
  const levels = new Set(
    violationsOn(violations, date).map((violation) => violation.level),
  );
  if (levels.has("limit")) {
    return "limit";
  }
  return levels.has("reminder") ? "reminder" : null;
};

/** `YYYY-MM-DD` → 年月日與星期(0 = 星期日)。 */
export const dateParts = (
  date: string,
): { year: number; month: number; day: number; weekday: number } => {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
};

/** `YYYY-MM-DD` → `12/3`。 */
export const shortDate = (date: string): string => {
  const { month, day } = dateParts(date);
  return `${String(month)}/${String(day)}`;
};

/** `YYYY-MM` 加減幾個月。 */
export const shiftMonth = (month: string, amount: number): string => {
  const [year = 0, value = 0] = month.split("-").map(Number);
  const index = year * 12 + (value - 1) + amount;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
};

const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

/** 是不是 `YYYY-MM`。 */
export const isMonth = (value: string): boolean => MONTH_PATTERN.test(value);

/**
 * 過去的月份(畫休總覽、我的畫休共用):早於「這個月」。這個月 = 目標月的前一個月 —— 目標月由 api
 * 依租戶時區的今天決定(`targetMonth` / 我的畫休目標月的 `month`),所以不用瀏覽器的時鐘。
 * 這個月與目標月都不算過去(截止後照樣顯示「已截止」與代改)。
 */
export const isPastDayOffMonth = (
  month: string,
  targetMonth: string,
): boolean => month < shiftMonth(targetMonth, -1);

/** 畫休種類(`@repo/domain/project/schedule-settings` 的 `SCHEDULE_DAY_OFF_KINDS`)。 */
export type DayOffKind = "full-day" | "time-range";

/** 時段不可排的一段(對話框的輸入;`HH:mm`,空字串 = 還沒填)。 */
export interface DayOffSlot {
  startTime: string;
  endTime: string;
}

export const EMPTY_SLOT: DayOffSlot = { startTime: "", endTime: "" };

/** 一段有填完、而且開始早於結束。 */
export const isCompleteSlot = (slot: DayOffSlot): boolean =>
  slot.startTime !== "" && slot.endTime !== "" && slot.startTime < slot.endTime;

/**
 * 要送出的時段:每一段都要填完且開始早於結束(全空的一段略過);沒有任何一段、或有填一半的 → null。
 */
export const completeSlots = (
  slots: readonly DayOffSlot[],
): DayOffSlot[] | null => {
  const filled = slots.filter(
    (slot) => slot.startTime !== "" || slot.endTime !== "",
  );
  return filled.length > 0 && filled.every((slot) => isCompleteSlot(slot))
    ? filled.map((slot) => ({
        startTime: slot.startTime,
        endTime: slot.endTime,
      }))
    : null;
};
