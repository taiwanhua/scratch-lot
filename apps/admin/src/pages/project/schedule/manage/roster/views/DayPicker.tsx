import { useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { CloseIcon } from "@repo/ui/icons";
import {
  MonthCalendar,
  type MonthCalendarDayInfo,
} from "@repo/ui/month-calendar";
import { Popover } from "@repo/ui/popover";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import { ScheduleLegend } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";
import { daysMissingPeople } from "@/lib/project/schedule-roster-views";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import type { RosterData } from "../roster-context";

export interface DayPickerProps {
  anchor: HTMLElement;
  /** 排班表資料(紅點、店休、特殊日只標得出已讀到的這個月) */
  data: RosterData | undefined;
  date: string;
  today: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

/** 月曆寬(px;Figma SC-46 浮層 312 寬扣掉左右留白)。 */
const PICKER_WIDTH = 296;

/**
 * 日檢視的選日期月曆(SC-46):底座 `MonthCalendar` 單選;有人力需求還缺人的日子右上角紅點、
 * 店休停用、特殊日寫名稱;[今天] 回到今天。電腦、平板、手機同一個浮層。
 */
export const DayPicker = ({
  anchor,
  data,
  date,
  today,
  onPick,
  onClose,
}: DayPickerProps) => {
  const t = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const [month, setMonth] = useState(date.slice(0, 7));
  const missing = daysMissingPeople(data?.demands ?? []);
  const days: Record<string, MonthCalendarDayInfo> = {};
  for (const missingDate of missing) {
    days[missingDate] = {
      corner: {
        variant: "dot",
        color: "error",
        label: t("timeline.missingDot"),
      },
    };
  }
  for (const day of data?.calendarDays ?? []) {
    if (day.type === "closed") {
      days[day.date] = {
        ...days[day.date],
        disabled: true,
        note: tCalendar("closed"),
      };
    } else if (isTagPaletteKey(day.paletteKey)) {
      days[day.date] = {
        ...days[day.date],
        note: (
          <TagPaletteChip paletteKey={day.paletteKey} label={day.name ?? ""} />
        ),
      };
    }
  }
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    tCalendar(`weekdays.${String(index)}`),
  );

  return (
    <Popover
      open
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      slotProps={{
        paper: { role: "dialog", "aria-label": t("timeline.pickDate") },
      }}
    >
      <Stack spacing={1} sx={{ p: 1.5, width: PICKER_WIDTH }}>
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
            {t("timeline.pickDate")}
          </Typography>
          <IconButton
            size="small"
            aria-label={t("toolbar.closeSheet")}
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          selectionMode="single"
          selectedDates={[date]}
          onSelectedDatesChange={(dates) => {
            const picked = dates.at(0);
            if (picked !== undefined) {
              onPick(picked);
            }
          }}
          days={days}
          today={today}
          weekdayLabels={weekdayLabels}
          formatMonthTitle={(value) =>
            tCalendar("monthTitle", {
              year: value.slice(0, 4),
              month: Number(value.slice(5, 7)),
            })
          }
          prevMonthLabel={tCalendar("prevMonth")}
          nextMonthLabel={tCalendar("nextMonth")}
          aria-label={t("timeline.pickDate")}
        />
        <ScheduleLegend items={["dotMissingPeople", "closed", "special"]} />
        <Box>
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              onPick(today);
            }}
          >
            {t("timeline.today")}
          </Button>
        </Box>
      </Stack>
    </Popover>
  );
};
