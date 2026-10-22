import { useState } from "react";
import { useTranslations } from "use-intl";

import { parseLocalDate } from "@repo/domain/form";
import { Box } from "@repo/ui/box";
import { MonthCalendar } from "@repo/ui/month-calendar";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  lastDayOfWeek,
  periodStartOf,
  shiftPeriod,
  weekdayOf,
} from "@/lib/project/reports/report-period";

import { PeriodShortcut } from "./PeriodShortcut";
import type { PeriodKindPickerProps } from "./period-picker-props";

/** 週的七天(`YYYY-MM-DD`,星期日起)。 */
const weekDaysOf = (sunday: string): string[] =>
  Array.from({ length: 7 }, (_, offset) => shiftPeriod("day", sunday, offset));

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** `YYYY-MM-DD` → `M/D`。 */
const shortDate = (date: string) =>
  `${String(Number(date.slice(5, 7)))}/${String(Number(date.slice(8, 10)))}`;

/**
 * 週:月曆點任一天選整週(星期日起),下方「10/11(日)~ 10/17(六)」+ [本週] [上週];不顯示週次。
 * 月曆顯示的月份只在這裡記(換月不改選取)。
 */
export const WeekPeriodPicker = ({
  value,
  today,
  onSelect,
}: PeriodKindPickerProps) => {
  const t = useTranslations("admin.lotteryReports.periodPicker");
  const thisWeek = periodStartOf("week", today);
  const lastWeek = shiftPeriod("week", today, -1);
  const [shownMonth, setShownMonth] = useState(value.slice(0, 7));
  const pick = (sunday: string) => {
    onSelect("week", sunday);
    setShownMonth(sunday.slice(0, 7));
  };
  const saturday = lastDayOfWeek(value);
  const weekday = (date: string) => {
    const parsed = parseLocalDate(date);
    return parsed === null ? "" : t(`weekdays.${String(weekdayOf(parsed))}`);
  };

  return (
    <Stack spacing={1.5}>
      {/* 月曆限寬:條件卡很寬時不讓七格撐滿整列(Figma RE-03 的月曆約 370) */}
      <Box sx={{ maxWidth: 560 }}>
        <MonthCalendar
          aria-label={t("weekCalendarAria")}
          month={shownMonth}
          onMonthChange={setShownMonth}
          selectionMode="single"
          selectedDates={weekDaysOf(value)}
          onSelectedDatesChange={(dates) => {
            // 單選模式:回報的就是點的那一天
            const date = dates.at(0);
            if (date !== undefined) pick(periodStartOf("week", date));
          }}
          today={today}
          weekdayLabels={WEEKDAYS.map((day) => t(`weekdays.${String(day)}`))}
          formatMonthTitle={(month) =>
            t("monthTitle", {
              year: Number(month.slice(0, 4)),
              month: Number(month.slice(5, 7)),
            })
          }
          prevMonthLabel={t("prevMonth")}
          nextMonthLabel={t("nextMonth")}
        />
      </Box>
      <Typography variant="subtitle2" color="primary">
        {t("weekRange", {
          from: shortDate(value),
          fromWeekday: weekday(value),
          to: shortDate(saturday),
          toWeekday: weekday(saturday),
        })}
      </Typography>
      <Stack direction="row" spacing={1}>
        <PeriodShortcut
          label={t("thisWeek")}
          isActive={value === thisWeek}
          onClick={() => {
            pick(thisWeek);
          }}
        />
        <PeriodShortcut
          label={t("lastWeek")}
          isActive={value === lastWeek}
          onClick={() => {
            pick(lastWeek);
          }}
        />
      </Stack>
      <Typography variant="caption" color="textSecondary">
        {t("weekHint")}
      </Typography>
    </Stack>
  );
};
