import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";

import { monthDayOf, shiftDay, weekdayOf } from "@/lib/project/schedule-roster";

import type { RosterNavigatorProps } from "../roster-views";
import { DayPicker } from "./DayPicker";
import { useRosterDate } from "./useRosterDate";

/**
 * 日檢視工具列的 `◀ 11/5(三)▾ ▶`(SC-45 / SC-46):◀ ▶ 前一天 / 後一天;點日期彈出整個月的月曆
 * (`DayPicker`,缺人的日子有紅點)。換到別的月份時排班表跟著換月份。
 */
export const DayNavigator = ({ data, month }: RosterNavigatorProps) => {
  const t = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { date, today, goTo } = useRosterDate(month);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const title = t("dateTitle", {
    date: monthDayOf(date),
    weekday: tCalendar(`weekdays.${String(weekdayOf(date))}`),
  });
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <IconButton
        size="small"
        aria-label={t("timeline.prevDate")}
        onClick={() => {
          goTo(shiftDay(date, -1));
        }}
      >
        <ChevronLeftIcon />
      </IconButton>
      <Button
        variant="text"
        size="small"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-label={t("timeline.pickDateAria", { date: title })}
        onClick={(event) => {
          setAnchor(event.currentTarget);
        }}
        sx={{ typography: "subtitle1", fontWeight: 600, color: "text.primary" }}
      >
        {t("timeline.dateButton", { date: title })}
      </Button>
      <IconButton
        size="small"
        aria-label={t("timeline.nextDate")}
        onClick={() => {
          goTo(shiftDay(date, 1));
        }}
      >
        <ChevronRightIcon />
      </IconButton>
      {anchor !== null && (
        <DayPicker
          anchor={anchor}
          data={data}
          date={date}
          today={today}
          onPick={(picked) => {
            setAnchor(null);
            goTo(picked);
          }}
          onClose={() => {
            setAnchor(null);
          }}
        />
      )}
    </Stack>
  );
};
