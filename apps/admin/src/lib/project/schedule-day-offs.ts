import {
  addLocalDays,
  addLocalMonths,
  instantOfLocalHhMm,
  localMonthRange,
  localMonthText,
  parseLocalDate,
  parseLocalMonth,
  toIso,
} from "@repo/domain/form";
import type { TagTone } from "@repo/ui/tag";

import { localDayTextOf } from "@/lib/base/form-engine/local-day";

/**
 * 畫休畫面共用的換算(我的畫休 SC-02、畫休總覽 SC-06;規格 14.5、14.6)。純函式,文案在呼叫端組。
 *
 * api 的日期與時段都是時點(日期 = 租戶時區那天 00:00);月曆格以租戶時區的日期鍵 `YYYY-MM-DD`
 * 對日子(`MonthCalendar` 收日期鍵),送出前換回時點。顯示一律走 `formatTemporal`(`useTemporalText`)。
 */

/** api 的日期(時點)→ 租戶時區的日期鍵 `YYYY-MM-DD`;不是時點 → 空字串。 */
export const dayKeyOf = (value: string, timezone: string): string =>
  localDayTextOf(value, timezone) ?? "";

/** 違反的形狀(GraphQL `ScheduleDayOffViolation` 用得到的欄位;`dates` 是時點)。 */
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

/** 涉及那天(日期鍵)的違反(當天詳細的「涉及的規則」)。 */
export const violationsOn = <T extends DayOffViolationLike>(
  violations: readonly T[],
  date: string,
  timezone: string,
): T[] =>
  violations.filter((violation) =>
    violation.dates.some((value) => dayKeyOf(value, timezone) === date),
  );

/** 那天(日期鍵)底部的色帶:涉及那天的違反裡最嚴重的等級(紅 = 限制、橘 = 提醒);沒有回 null。 */
export const dayOffBandOf = (
  violations: readonly DayOffViolationLike[],
  date: string,
  timezone: string,
): DayOffBandLevel | null => {
  const levels = new Set(
    violationsOn(violations, date, timezone).map(
      (violation) => violation.level,
    ),
  );
  if (levels.has("limit")) {
    return "limit";
  }
  return levels.has("reminder") ? "reminder" : null;
};

/**
 * 月份鍵 `YYYY-MM` → api 月份查詢的 `from` / `to`(那個月在租戶時區的 `[月初 00:00, 下月初 00:00)`);
 * 不是月份鍵 → null。
 */
export const monthRangeOf = (
  month: string,
  timezone: string,
): { from: string; to: string } | null => {
  const parsed = parseLocalMonth(month);
  if (parsed === null) {
    return null;
  }
  const range = localMonthRange(parsed, timezone);
  return { from: toIso(range.from), to: toIso(range.to) };
};

/**
 * 過去的月份(畫休總覽、我的畫休共用):早於「這個月」。這個月 = 目標月的前一個月 —— 目標月由 api
 * 依租戶時區的今天決定(`targetMonth` / 我的畫休目標月的 `month`),所以不用瀏覽器的時鐘。
 * 這個月與目標月都不算過去(截止後照樣顯示「已截止」與代改)。
 */
export const isPastDayOffMonth = (
  month: string,
  targetMonth: string,
): boolean => {
  const target = parseLocalMonth(targetMonth);
  return target !== null && month < localMonthText(addLocalMonths(target, -1));
};

/** 畫休種類(`@repo/domain/project/schedule-settings` 的 `SCHEDULE_DAY_OFF_KINDS`)。 */
export type DayOffKind = "full-day" | "time-range";

/** 時段不可排的一段(對話框的輸入;`HH:mm`,空字串 = 還沒填)。 */
export interface DayOffSlot {
  startTime: string;
  endTime: string;
}

export const EMPTY_SLOT: DayOffSlot = { startTime: "", endTime: "" };

/**
 * 結束選 `00:00` = 隔天 00:00(做到當天結束;api 的時段是半開區間 `[開始, 結束)`,結束最晚隔天 00:00)。
 * 沿用排班上下班「結束不晚於開始就算隔天」(`spanOf`),但時段不能再往後跨:只有 00:00 算隔天。
 */
const END_OF_DAY = "00:00";

/** 一段有填完、而且開始早於結束(結束 `00:00` = 隔天 00:00,任何開始都早於它)。 */
export const isCompleteSlot = (slot: DayOffSlot): boolean =>
  slot.startTime !== "" &&
  slot.endTime !== "" &&
  (slot.endTime === END_OF_DAY || slot.startTime < slot.endTime);

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

/**
 * 時段(那天的 `HH:mm`)→ api 收的時點 `startAt` / `endAt`(日期 + 時刻以租戶時區合成;
 * 結束 `00:00` = 隔天 00:00);日期鍵或任一時刻不合法 → null。
 */
export const slotInstantsOf = (
  date: string,
  slots: readonly DayOffSlot[],
  timezone: string,
): { startAt: string; endAt: string }[] | null => {
  const day = parseLocalDate(date);
  if (day === null) {
    return null;
  }
  const nextDay = addLocalDays(day, 1);
  const spans = slots.map((slot) => ({
    start: instantOfLocalHhMm(day, slot.startTime, timezone),
    end: instantOfLocalHhMm(
      slot.endTime === END_OF_DAY ? nextDay : day,
      slot.endTime,
      timezone,
    ),
  }));
  return spans.every((span) => span.start !== null && span.end !== null)
    ? spans.map((span) => ({
        startAt: toIso(span.start ?? 0),
        endAt: toIso(span.end ?? 0),
      }))
    : null;
};
