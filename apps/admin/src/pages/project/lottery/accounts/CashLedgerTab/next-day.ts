import { addLocalDays, localDateText, parseLocalDate } from "@repo/domain/form";

/** `YYYY-MM-DD` 的隔天(日期篩選的「不含」上限;`addLocalDays`);不是日期 → null。 */
export const nextDayText = (text: string): string | null => {
  const date = parseLocalDate(text);
  return date === null ? null : localDateText(addLocalDays(date, 1));
};
