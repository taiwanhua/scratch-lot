import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { tagPaletteBackgroundVarsSx } from "@/components/project/TagPaletteChip/tag-palette-background";
import {
  calendarMarkBackground,
  calendarMarkOf,
} from "@/components/project/schedule/CalendarMark/calendar-mark";
import { ScheduleLegend } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";
import { unmatchedCountsByDate } from "@/lib/project/schedule-attendance";
import {
  demandToneOf,
  monthDayOf,
  weekdayOf,
} from "@/lib/project/schedule-roster";
import {
  filledTotalText,
  weekListLine,
} from "@/lib/project/schedule-roster-views";

import { rosterCellKey, useRoster } from "../roster-context";
import { UnmatchedPunchMark } from "./UnmatchedPunchMark";
import { ROSTER_LEGEND_ITEMS } from "./roster-legend";
import { useShowDay } from "./useRosterDate";
import { useTimelineGroups } from "./useTimelineGroups";

export interface WeekMobileListProps {
  /** 那一週的 7 天 */
  dates: readonly string[];
}

/**
 * 手機週檢視(SC-44 手機;規格 14.5 週):7 天清單,每天一列,列出各人力需求的簡稱與人數
 * (「早 2/2 · 晚 1/2」,每筆一個三態標籤);點一天切到那天的日檢視。特殊日用它的顏色當底、店休停用底色;
 * 有未對應排班的打卡的日子在日期旁顯示「⏲ N」(同電腦版)。
 */
export const WeekMobileList = ({ dates }: WeekMobileListProps) => {
  const t = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { data, timezone } = useRoster();
  const showDay = useShowDay();
  const timeline = useTimelineGroups(dates, "week");
  const punchCounts = unmatchedCountsByDate(data.unmatchedPunches);
  const calendarByDate = new Map(
    data.calendarDays.map((day) => [day.date, day]),
  );

  return (
    <Stack spacing={1.5} sx={tagPaletteBackgroundVarsSx}>
      <Stack spacing={1}>
        {dates.map((date) => {
          const mark = calendarMarkOf(calendarByDate.get(date));
          const items = timeline.plansOf(date).map((plan) => ({
            plan,
            wording: {
              ...timeline.wordingOf(plan.demand),
              counts: plan.counts,
            },
          }));
          const title = t("dateTitle", {
            date: monthDayOf(date, timezone),
            weekday: tCalendar(`weekdays.${String(weekdayOf(date))}`),
          });
          return (
            <Box
              key={date}
              component="button"
              data-roster-cell={rosterCellKey({ date })}
              aria-label={t("timeline.showDayAria", {
                date: title,
                summary: weekListLine(items.map((item) => item.wording)),
              })}
              onClick={() => {
                showDay(date);
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
                p: 1.5,
                border: 1,
                borderColor: "divider",
                borderRadius: 1.5,
                bgcolor: calendarMarkBackground(mark),
                color: "text.primary",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <Typography variant="subtitle2" sx={{ flex: "none" }}>
                {title}
                {mark.kind === "special" && mark.name !== null ? mark.name : ""}
                <UnmatchedPunchMark
                  count={punchCounts.get(date) ?? 0}
                  placement={{ ml: 0.5 }}
                />
              </Typography>
              <Stack
                direction="row"
                spacing={0.5}
                useFlexGap
                sx={{ flex: 1, flexWrap: "wrap", minWidth: 0 }}
              >
                {mark.kind === "closed" && (
                  <Typography variant="caption" color="textSecondary">
                    {t("cell.closed")}
                  </Typography>
                )}
                {items.map(({ plan, wording }) => (
                  <Tag
                    key={plan.demand.id}
                    tone={demandToneOf(wording.counts)}
                    label={`${wording.shortName} ${filledTotalText(wording.counts)}`}
                  />
                ))}
              </Stack>
              <Box
                component="span"
                aria-hidden
                sx={{ color: "text.secondary" }}
              >
                ›
              </Box>
            </Box>
          );
        })}
      </Stack>
      <ScheduleLegend items={ROSTER_LEGEND_ITEMS.weekMobile} />
    </Stack>
  );
};
