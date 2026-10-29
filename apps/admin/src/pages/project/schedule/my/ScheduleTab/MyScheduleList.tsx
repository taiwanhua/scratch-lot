import { useTranslations } from "use-intl";

import type { MyScheduleQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { tagPaletteBackgroundVarsSx } from "@repo/ui/theme";
import { Typography } from "@repo/ui/typography";

import {
  calendarMarkBackground,
  calendarMarkOf,
} from "@/components/project/schedule/CalendarMark/calendar-mark";
import { dayOffHatchSx } from "@/components/project/schedule/DayOffs/day-off-styles";
import { groupByDate, listDatesOf } from "@/lib/project/schedule-my";

import { type MyEntry, useMyEntryText } from "./useMyEntryText";

type Page = MyScheduleQuery["mySchedule"];

export interface MyScheduleListProps {
  page: Page;
  changedDates: ReadonlySet<string>;
  onOpenDay: (date: string) => void;
}

const EntryRow = ({ entry }: { entry: MyEntry }) => {
  const t = useTranslations("admin.schedule.mySchedule");
  const text = useMyEntryText();
  const missing = text.missing(entry);
  const clockIn = text.punchTime(entry.clockIn);
  const clockOut = text.punchTime(entry.clockOut);
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.5, sm: 1 }}
      sx={{ alignItems: { sm: "flex-start" } }}
    >
      <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.25}>
        <Typography variant="body2">
          {`${entry.orgName} ${text.shortName(entry)} ${text.time(entry)}`}
        </Typography>
        {(clockIn !== null || clockOut !== null || missing !== null) && (
          <Typography variant="caption" color="textSecondary">
            {t("list.punches", {
              in: clockIn ?? t("calendar.noPunch"),
              out: clockOut ?? t("calendar.noPunch"),
            })}
          </Typography>
        )}
      </Stack>
      <Stack
        direction="row"
        spacing={0.75}
        useFlexGap
        sx={{
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: { sm: "flex-end" },
        }}
      >
        {entry.breakMinutes > 0 && (
          <Typography
            variant="caption"
            color="textSecondary"
            aria-label={t("punch.breakAria", { minutes: entry.breakMinutes })}
          >
            {t("list.break", { minutes: entry.breakMinutes })}
          </Typography>
        )}
        <Tag
          tone={entry.isLead ? "success" : "grey"}
          label={entry.isLead ? t("role.leader") : t("role.helper")}
        />
        {missing !== null && <Tag tone="error" label={missing} />}
      </Stack>
    </Stack>
  );
};

/**
 * 條列檢視(SC-40;規格 14.6「`[月曆 | 條列]`」):依日期列出這個月的班與打卡;畫休、店休也列一行;
 * 今天標「今天」、有異動的日子寫「有異動」;特殊日整行底色 = 行事曆選的顏色並寫名稱(判斷同月曆與排班表,`calendarMarkOf`);
 * 畫休用灰色斜線底、休息寫「☕ 30」(同圖例)。點一列 → 當天詳情。
 */
export const MyScheduleList = ({
  page,
  changedDates,
  onOpenDay,
}: MyScheduleListProps) => {
  const t = useTranslations("admin.schedule.mySchedule");
  const text = useMyEntryText();
  const byDate = groupByDate(page.entries);
  const marks = new Map(
    page.calendarDays.map((day) => [day.date, calendarMarkOf(day)]),
  );
  const closed = new Set(
    [...marks].filter(([, mark]) => mark.kind === "closed").map(([d]) => d),
  );
  const dayOffs = new Set(page.dayOffDates);
  const dates = listDatesOf({
    month: page.month,
    today: page.today,
    entryDates: [...byDate.keys()],
    dayOffDates: page.dayOffDates,
    closedDates: [...closed],
  });
  if (dates.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("list.empty")}
      </Typography>
    );
  }
  return (
    <Stack
      component="ul"
      sx={[{ listStyle: "none", m: 0, p: 0 }, tagPaletteBackgroundVarsSx]}
    >
      {dates.map((date) => {
        const entries = byDate.get(date) ?? [];
        const isToday = date === page.today;
        const mark = marks.get(date) ?? { kind: "none" };
        return (
          <Box
            component="li"
            key={date}
            data-my-list-day={date}
            // 店休整行店休灰、特殊日整行色票底(`calendarMarkBackground`);特殊日:行事曆選的色票
            data-special={mark.kind === "special" ? mark.paletteKey : undefined}
            onClick={() => {
              onOpenDay(date);
            }}
            sx={{
              display: "flex",
              gap: 2,
              py: 1.25,
              px: 1,
              bgcolor: calendarMarkBackground(mark),
              borderBottom: 1,
              borderColor: "divider",
              cursor: "pointer",
            }}
          >
            <Typography
              variant="body2"
              sx={{ width: { xs: 72, sm: 96 }, flexShrink: 0, fontWeight: 600 }}
              color={isToday ? "primary" : "textPrimary"}
            >
              {isToday
                ? `${text.dateTitle(date)}${t("list.todaySuffix")}`
                : text.dateTitle(date)}
            </Typography>
            <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
              {mark.kind === "closed" && (
                <Typography variant="body2">{t("calendar.closed")}</Typography>
              )}
              {mark.kind === "special" && mark.name !== null && (
                <Typography variant="body2">{mark.name}</Typography>
              )}
              {dayOffs.has(date) && (
                // 畫休一律灰色斜線底(同月曆、圖例「畫休(斜線)」)
                <Box
                  sx={{
                    position: "relative",
                    alignSelf: "flex-start",
                    px: 0.75,
                    borderRadius: 0.5,
                    overflow: "hidden",
                  }}
                >
                  <Box aria-hidden data-day-off-hatch sx={dayOffHatchSx} />
                  <Typography variant="body2">
                    {t("calendar.dayOff")}
                  </Typography>
                </Box>
              )}
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
              {changedDates.has(date) && (
                <Typography variant="caption" sx={{ color: "warning.dark" }}>
                  {t("list.changed")}
                </Typography>
              )}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
};
