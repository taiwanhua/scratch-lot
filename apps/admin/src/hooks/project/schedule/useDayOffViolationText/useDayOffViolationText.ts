import { useTranslations } from "use-intl";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import { lastDayShownAt } from "@/lib/project/schedule-roster";

/** 畫休違反用得到的欄位(GraphQL `ScheduleDayOffViolation`,或存檔被擋時 `extensions.violations`)。 */
export interface DayOffViolationTextInput {
  key: string;
  message: string;
  actual?: number | null;
  limit?: number | null;
  /** 期間類:半開的時點區間 `[起那天 00:00, 迄那天的隔天 00:00)`(顯示的迄日 = `to` 的前一天) */
  from?: string | null;
  to?: string | null;
}

/**
 * 畫休違反的一句話(違規清單、存檔被擋下的原因):依規則 key 組文案(`admin.schedule.dayOffs.violations`);
 * 不認得的 key 退回 api 的說明。
 */
export const useDayOffViolationText = (): ((
  violation: DayOffViolationTextInput,
) => string) => {
  const t = useTranslations("admin.schedule.dayOffs.violations");
  const text = useTemporalText();
  return (violation) => {
    const actual = violation.actual ?? 0;
    const limit = violation.limit ?? 0;
    const from =
      violation.from === null || violation.from === undefined
        ? ""
        : text(violation.from, "monthDay");
    const lastDay = lastDayShownAt(violation.to);
    const to = lastDay === null ? "" : text(lastDay, "monthDay");
    switch (violation.key) {
      case "maxMonthlyDayOffs": {
        return t("maxMonthlyDayOffs", { actual, limit });
      }
      case "minMonthlyDayOffs": {
        return t("minMonthlyDayOffs", { actual, limit });
      }
      case "maxConsecutiveDaysOff": {
        return t("maxConsecutiveDaysOff", { actual, limit, from, to });
      }
      case "maxDailyDayOffStaff": {
        return t("maxDailyDayOffStaff", { actual, limit, date: from });
      }
      default: {
        return violation.message;
      }
    }
  };
};
