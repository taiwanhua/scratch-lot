import { useTranslations } from "use-intl";

import type { MyScheduleQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { useBreakpointDown } from "@repo/ui/media-query";
import {
  MonthCalendar,
  type MonthCalendarCorner,
  type MonthCalendarDayInfo,
} from "@repo/ui/month-calendar";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { leaderMarkSx } from "@/components/project/schedule/ScheduleLegend/schedule-legend-styles";
import { groupByDate } from "@/lib/project/schedule-my";
import { isTagPaletteKey, tagPaletteColorOf } from "@/lib/project/tag-palettes";

import { type MyEntry, useMyEntryText } from "./useMyEntryText";

type Page = MyScheduleQuery["mySchedule"];

/** 範本簡稱(負責人套綠底;未套用範本寫「臨」)。 */
export const ShortNameMark = ({ entry }: { entry: MyEntry }) => {
  const text = useMyEntryText();
  return (
    <Box
      component="span"
      sx={[
        { typography: "caption", fontWeight: 600, px: 0.5 },
        entry.isLead ? leaderMarkSx : {},
      ]}
    >
      {text.shortName(entry)}
    </Box>
  );
};

const EntryLines = ({
  entry,
  compact,
}: {
  entry: MyEntry;
  compact: boolean;
}) => {
  const t = useTranslations("admin.schedule.mySchedule.calendar");
  const text = useMyEntryText();
  if (compact) {
    return <ShortNameMark entry={entry} />;
  }
  const clockIn = text.punchTime(entry.clockIn);
  const clockOut = text.punchTime(entry.clockOut);
  return (
    <Stack spacing={0.25}>
      <Stack
        direction="row"
        spacing={0.5}
        useFlexGap
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <ShortNameMark entry={entry} />
        <Typography variant="caption">{text.time(entry)}</Typography>
      </Stack>
      {(clockIn !== null || clockOut !== null) && (
        <Typography variant="caption" color="textSecondary">
          {t("punchTimes", {
            in: clockIn ?? t("noPunch"),
            out: clockOut ?? t("noPunch"),
          })}
        </Typography>
      )}
    </Stack>
  );
};

/**
 * 行事曆:店休寫「店休」;特殊日整格底色 = 行事曆選的顏色(底座淡化),沒選顏色退回 `tone: special`,並寫名稱。
 */
const calendarInfoOf = (
  day: Page["calendarDays"][number] | undefined,
  closedLabel: string,
): Pick<MonthCalendarDayInfo, "note" | "tone" | "background"> => {
  if (day?.type === "closed") {
    return { note: closedLabel };
  }
  if (day?.type !== "special") {
    return {};
  }
  const note = day.name ?? undefined;
  return {
    ...(note === undefined ? {} : { note }),
    ...(isTagPaletteKey(day.paletteKey)
      ? { background: tagPaletteColorOf(day.paletteKey) }
      : { tone: "special" as const }),
  };
};

export interface MyMonthCalendarProps {
  page: Page;
  changedDates: ReadonlySet<string>;
  onOpenDay: (date: string) => void;
}

/**
 * 月曆(SC-01;規格 14.6「月曆」):底座 `MonthCalendar`。每天顯示自己的排班(範本簡稱、時間;負責人綠底)與
 * 打卡紀錄(上班 / 下班);已結束的班缺卡在右上角紅點、有異動的日子金點(同一天兩者都有時並排,紅點在前);
 * 店休寫在日期下方;特殊日整格底色 = 行事曆選的顏色(底座 `MonthCalendar` 的 `background`,沒選顏色退回 `tone`)並寫名稱;整天畫休寫「畫休」。手機只放簡稱。點一天 → 當天詳情。
 */
export const MyMonthCalendar = ({
  page,
  changedDates,
  onOpenDay,
}: MyMonthCalendarProps) => {
  const t = useTranslations("admin.schedule.mySchedule.calendar");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const isMobile = useBreakpointDown("sm");
  const byDate = groupByDate(page.entries);
  const calendarByDate = new Map(
    page.calendarDays.map((day) => [day.date, day]),
  );
  const dayOffs = new Set(page.dayOffDates);
  const dates = new Set([
    ...byDate.keys(),
    ...calendarByDate.keys(),
    ...dayOffs,
    ...changedDates,
  ]);

  const days: Record<string, MonthCalendarDayInfo> = {};
  for (const date of dates) {
    const entries = byDate.get(date) ?? [];
    const hasMissing = entries.some((entry) => entry.missing.length > 0);
    const corners: MonthCalendarCorner[] = [
      ...(hasMissing
        ? [{ variant: "dot", color: "error", label: t("missingDot") } as const]
        : []),
      ...(changedDates.has(date)
        ? [
            {
              variant: "dot",
              color: "warning",
              label: t("changedDot"),
            } as const,
          ]
        : []),
    ];
    days[date] = {
      ...calendarInfoOf(calendarByDate.get(date), t("closed")),
      ...(corners.length === 0 ? {} : { corners }),
      content: (
        <Stack spacing={0.5} data-my-day={date}>
          {dayOffs.has(date) && (
            <Typography variant="caption">{t("dayOff")}</Typography>
          )}
          {entries.map((entry) => (
            <EntryLines key={entry.id} entry={entry} compact={isMobile} />
          ))}
        </Stack>
      ),
    };
  }

  return (
    <MonthCalendar
      month={page.month}
      showHeader={false}
      today={page.today}
      selectionMode="single"
      selectedDates={[]}
      onSelectedDatesChange={(selected) => {
        const date = selected.at(0);
        if (date !== undefined) {
          onOpenDay(date);
        }
      }}
      days={days}
      weekdayLabels={[0, 1, 2, 3, 4, 5, 6].map((day) =>
        tCalendar(`weekdays.${String(day)}`),
      )}
    />
  );
};
