import { useTranslations } from "use-intl";

import {
  DEFAULT_TENANT_TIMEZONE,
  parseLocalDate,
  weekdayOfLocalDate,
} from "@repo/domain/form";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";

/**
 * 畫休對話框的日期標題:日期鍵 `YYYY-MM-DD`(月曆格)→「12/24(四)」。月日走 `formatTemporal` 的
 * `monthDay`(租戶時區),星期沿用行事曆的 `weekdays`;不是日期鍵 → 空字串。
 */
export const useDayOffDateTitle = (): ((date: string) => string) => {
  const t = useTranslations("admin.schedule.dayOffs");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const text = useTemporalText();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  return (date) => {
    const day = parseLocalDate(date);
    if (day === null) {
      return "";
    }
    return t("dateTitle", {
      date: text(localDayInstantOf(date, timezone), "monthDay"),
      weekday: tCalendar(`weekdays.${String(weekdayOfLocalDate(day))}`),
    });
  };
};
