import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { monthDayOf, weekdayOf } from "@/lib/project/schedule-roster";

/**
 * 排班表的日期標題:日期鍵 `YYYY-MM-DD` →「11/5(三)」(月日走 `formatTemporal` 的 `monthDay`,租戶時區;
 * 星期沿用行事曆的 `weekdays`)。空字串 → 空字串。
 */
export const useRosterDateTitle = (): ((date: string) => string) => {
  const tRoster = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  return (date) =>
    date === ""
      ? ""
      : tRoster("dateTitle", {
          date: monthDayOf(date, timezone),
          weekday: tCalendar(`weekdays.${String(weekdayOf(date))}`),
        });
};
