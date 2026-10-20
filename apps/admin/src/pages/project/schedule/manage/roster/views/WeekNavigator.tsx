import { useTranslations } from "use-intl";

import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { monthDayOf, shiftDay } from "@/lib/project/schedule-roster";
import { weekDatesOf } from "@/lib/project/schedule-roster-views";

import type { RosterNavigatorProps } from "../roster-views";
import { useRosterDate } from "./useRosterDate";

/** 週檢視工具列的 `◀ 11/8–11/14 ▶`(一週從星期日開始;換週跨月時排班表跟著換月份)。 */
export const WeekNavigator = ({ month }: RosterNavigatorProps) => {
  const t = useTranslations("admin.schedule.roster.timeline");
  const { date, goTo } = useRosterDate(month);
  const dates = weekDatesOf(date);
  const first = dates.at(0) ?? date;
  const last = dates.at(-1) ?? date;
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <IconButton
        size="small"
        aria-label={t("prevWeek")}
        onClick={() => {
          goTo(shiftDay(date, -7));
        }}
      >
        <ChevronLeftIcon />
      </IconButton>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t("weekTitle", { from: monthDayOf(first), to: monthDayOf(last) })}
      </Typography>
      <IconButton
        size="small"
        aria-label={t("nextWeek")}
        onClick={() => {
          goTo(shiftDay(date, 7));
        }}
      >
        <ChevronRightIcon />
      </IconButton>
    </Stack>
  );
};
