import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
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

import {
  calendarMarkBackground,
  calendarMarkMonthBackground,
  calendarMarkOf,
} from "@/components/project/schedule/CalendarMark/calendar-mark";
import { dayOffHatchSx } from "@/components/project/schedule/DayOffs/day-off-styles";
import { leaderMarkSx } from "@/components/project/schedule/ScheduleLegend/schedule-legend-styles";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { groupByDate } from "@/lib/project/schedule-my";

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
 * 行事曆(判斷見 `calendarMarkOf`,條列與排班表同一套):店休寫「店休」(整格店休灰見 `ClosedLayer`);特殊日整格底色 = 行事曆選的顏色(底座淡化,`calendarMarkMonthBackground`)並寫名稱。
 */
const calendarInfoOf = (
  day: Page["calendarDays"][number] | undefined,
  closedLabel: string,
): Pick<MonthCalendarDayInfo, "note" | "background"> => {
  const mark = calendarMarkOf(day);
  if (mark.kind === "closed") {
    return { note: closedLabel };
  }
  if (mark.kind === "none") {
    return {};
  }
  return {
    ...(mark.name === null ? {} : { note: mark.name }),
    background: calendarMarkMonthBackground(mark),
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
 * 店休整格店休灰(仍可點)並寫在日期下方;特殊日整格底色 = 行事曆選的顏色(底座 `MonthCalendar` 的 `background`)並寫名稱;整天畫休整格灰色斜線底並寫「畫休」。手機只放簡稱。點一天 → 當天詳情。
 * 圖例項目見 `my-schedule-legend.ts`。
 */
export const MyMonthCalendar = ({
  page,
  changedDates,
  onOpenDay,
}: MyMonthCalendarProps) => {
  const t = useTranslations("admin.schedule.mySchedule.calendar");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const isMobile = useBreakpointDown("sm");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const byDate = groupByDate(page.entries);
  const calendarByDate = new Map(
    page.calendarDays.map((day) => [day.date, day]),
  );
  const dayOffs = new Set(page.dayOffDates);
  const closedDates = new Set(
    page.calendarDays
      .filter((day) => calendarMarkOf(day).kind === "closed")
      .map((day) => day.date),
  );
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
        <>
          {/* 店休:整格店休灰(同排班表的店休;底座 `disabled` 會讓格子不能點,這裡要可點看當天,所以鋪在內容底層) */}
          {closedDates.has(date) && (
            <Box
              aria-hidden
              data-closed-layer
              sx={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                bgcolor: calendarMarkBackground({ kind: "closed" }),
              }}
            />
          )}
          {/* 整天畫休:整格灰色斜線底(同我的畫休月曆、圖例「畫休(斜線)」);日期、角標、店休 / 特殊日名稱由底座疊在上面 */}
          {dayOffs.has(date) && (
            <Box aria-hidden data-day-off-hatch sx={dayOffHatchSx} />
          )}
          {/* 文字疊在斜線之上(`position: relative`,同 `DayOffCellContent`) */}
          <Stack spacing={0.5} data-my-day={date} sx={{ position: "relative" }}>
            {dayOffs.has(date) && (
              <Typography variant="caption">{t("dayOff")}</Typography>
            )}
            {entries.map((entry) => (
              <EntryLines key={entry.id} entry={entry} compact={isMobile} />
            ))}
          </Stack>
        </>
      ),
    };
  }

  return (
    <MonthCalendar
      month={page.month}
      showHeader={false}
      today={page.today}
      timezone={timezone}
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
