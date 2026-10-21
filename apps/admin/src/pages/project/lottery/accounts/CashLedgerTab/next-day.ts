import { localDateText, parseLocalDate } from "@repo/domain/form";

/** `YYYY-MM-DD` 的隔天(日期篩選的「不含」上限);不是日期 → null。 */
export const nextDayText = (text: string): string | null => {
  const date = parseLocalDate(text);
  if (date === null) {
    return null;
  }
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return localDateText({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
};
