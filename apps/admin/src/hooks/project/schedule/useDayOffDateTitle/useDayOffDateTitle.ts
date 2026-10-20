import { useTranslations } from "use-intl";

import { dateParts } from "@/lib/project/schedule-day-offs";

/** 畫休對話框的日期標題:`YYYY-MM-DD` →「12/24(四)」(星期沿用行事曆的 `weekdays`)。 */
export const useDayOffDateTitle = (): ((date: string) => string) => {
  const t = useTranslations("admin.schedule.dayOffs");
  const tCalendar = useTranslations("admin.schedule.calendar");
  return (date) => {
    const { month, day, weekday } = dateParts(date);
    return t("dateTitle", {
      month,
      day,
      weekday: tCalendar(`weekdays.${String(weekday)}`),
    });
  };
};
