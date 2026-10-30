import {
  formatTemporal,
  parseLocalDate,
  startOfLocalDay,
  toInstant,
  toIso,
} from "@repo/domain/form";

/**
 * 日期選擇器(`@repo/ui` 的 `DatePicker`,收發 `YYYY-MM-DD`)與日期存值(時點)之間的換算
 * (`date` 存的是選的那一天在租戶時區 00:00 的時點):
 * 填寫的日期欄、預設值的固定日期共用。
 */

/** 時點(ISO / `Date`)→ 那個時區的 `YYYY-MM-DD`(給選擇器);不是時點 → null。 */
export const localDayTextOf = (
  value: unknown,
  timezone: string,
): string | null =>
  toInstant(value) === null
    ? null
    : formatTemporal(value, { type: "date", timezone });

/** 選擇器給的 `YYYY-MM-DD` → 那一天在時區 00:00 的 ISO;清空或不是日期 → null。 */
export const localDayInstantOf = (
  text: string | null,
  timezone: string,
): string | null => {
  const date = parseLocalDate(text);
  return date === null ? null : toIso(startOfLocalDay(date, timezone));
};

/** `YYYY-MM-DD` 的「M/D」(那天在時區 00:00 走 `formatTemporal` 的 `monthDay`);不是日期 → 空字串。 */
export const monthDayOf = (date: string, timezone: string): string =>
  formatTemporal(localDayInstantOf(date, timezone), {
    type: "monthDay",
    timezone,
  });
