import { useState } from "react";
import { useTranslations } from "use-intl";

import { useScheduleRosterQuery } from "@repo/graphql";
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
import { useSession } from "@/hooks/base/useSession";
import { dayWorstTones } from "@/lib/project/schedule-roster-views";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import type { RosterData } from "../roster-context";

export interface DayPickerProps {
  anchor: HTMLElement;
  /** 排班表目前讀到的那個月(月曆翻到別的月時另讀那個月) */
  data: RosterData | undefined;
  date: string;
  today: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

/** 月曆寬(px;Figma SC-46 浮層 312 寬扣掉左右留白)。 */
const PICKER_WIDTH = 296;

/**
 * 日檢視的選日期月曆(SC-46):底座 `MonthCalendar` 單選;右上角的點 = 當天最嚴重的狀態(缺負責紅、只缺協同橘、排滿不畫)、
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
  const { session } = useSession();
  // 月曆翻到別的月:讀那家店那個月的排班表再標點、店休、特殊日
  const other = useScheduleRosterQuery(
    session.client,
    { input: { month, ...(data === undefined ? {} : { orgId: data.orgId }) } },
    { enabled: data !== undefined && month !== data.month },
  );
  const shown = month === data?.month ? data : other.data?.scheduleRoster;
  const days: Record<string, MonthCalendarDayInfo> = {};
  // 當天最嚴重的狀態:缺負責紅點、只缺協同橘點、排滿不畫(同手機月檢視的點)
  for (const [date, tone] of dayWorstTones(shown?.demands ?? [])) {
    days[date] = {
      corner: {
        variant: "dot",
        color: tone,
        label: t(
          tone === "error"
            ? "timeline.missingLeaderDot"
            : "timeline.missingHelperDot",
        ),
      },
    };
  }
  for (const day of shown?.calendarDays ?? []) {
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
        <ScheduleLegend
          items={["dotMissingLeader", "dotMissingHelper", "closed", "special"]}
        />
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
