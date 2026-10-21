import { useTranslations } from "use-intl";

import type { MyScheduleQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

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
          <Typography variant="caption" color="text.secondary">
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
            color="text.secondary"
            aria-label={t("punch.breakAria", { minutes: entry.breakMinutes })}
          >
            ☕{entry.breakMinutes}
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
 * 今天標「今天」、有異動的日子寫「有異動」。點一列 → 當天詳情。
 */
export const MyScheduleList = ({
  page,
  changedDates,
  onOpenDay,
}: MyScheduleListProps) => {
  const t = useTranslations("admin.schedule.mySchedule");
  const text = useMyEntryText();
  const byDate = groupByDate(page.entries);
  const closed = new Set(
    page.calendarDays
      .filter((day) => day.type === "closed")
      .map((day) => day.date),
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
      <Typography variant="body2" color="text.secondary">
        {t("list.empty")}
      </Typography>
    );
  }
  return (
    <Stack component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {dates.map((date) => {
        const entries = byDate.get(date) ?? [];
        const isToday = date === page.today;
        return (
          <Box
            component="li"
            key={date}
            data-my-list-day={date}
            onClick={() => {
              onOpenDay(date);
            }}
            sx={{
              display: "flex",
              gap: 2,
              py: 1.25,
              borderBottom: 1,
              borderColor: "divider",
              cursor: "pointer",
            }}
          >
            <Typography
              variant="body2"
              sx={{ width: { xs: 72, sm: 96 }, flexShrink: 0, fontWeight: 600 }}
              color={isToday ? "primary.main" : "text.primary"}
            >
              {isToday
                ? `${text.dateTitle(date)}${t("list.todaySuffix")}`
                : text.dateTitle(date)}
            </Typography>
            <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
              {closed.has(date) && (
                <Typography variant="body2">{t("calendar.closed")}</Typography>
              )}
              {dayOffs.has(date) && (
                <Typography variant="body2">{t("calendar.dayOff")}</Typography>
              )}
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
              {changedDates.has(date) && (
                <Typography variant="caption" color="warning.dark">
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
