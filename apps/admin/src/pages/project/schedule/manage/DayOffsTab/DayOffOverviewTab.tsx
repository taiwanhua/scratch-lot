import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  type ScheduleDayOffDayFieldsFragment,
  useScheduleDayOffOverviewQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import {
  MonthCalendar,
  type MonthCalendarDayInfo,
} from "@repo/ui/month-calendar";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { DayOffCellContent } from "@/components/project/schedule/DayOffs/DayOffCellContent";
import { DayOffLegend } from "@/components/project/schedule/DayOffs/DayOffLegend";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  dateParts,
  isMonth,
  shiftMonth,
  shortDate,
} from "@/lib/project/schedule-day-offs";

import { OverrideDayOffDialog } from "./OverrideDayOffDialog";

const orgSchema = z.string().default("");
/** `?month=YYYY-MM`;空字串 = 目前在登記的月份(api 決定:下個月)。 */
const monthSchema = z.string().default("");
/** `?dayOffFilter=`:全部 / 尚未畫休。 */
const filterSchema = z.enum(["all", "not-registered"]).default("all");

/** 開放期間的狀態 → 頂部那一句。 */
const WINDOW_KEY: Partial<
  Record<
    string,
    "overview.windowOpen" | "overview.windowClosed" | "overview.windowBefore"
  >
> = {
  open: "overview.windowOpen",
  closed: "overview.windowClosed",
  before: "overview.windowBefore",
};

/**
 * 排班作業 → 畫休總覽(SC-06;規格 14.5「畫休總覽」,`view-day-offs`):月曆每天顯示誰整天畫休、
 * 誰時段不可排(含時間)、同日畫休人數「2/2」(只計以這家店為主要分店的人);頂部開放期間與尚未畫休的人
 * (只算主要分店是這家的人),
 * 篩選 [全部] [尚未畫休]。[代改](SC-24)要 `edit-day-offs`,點日期也會打開並帶入那天。
 *
 * 分店選擇器是可見範圍模式(`scope="visible"`,同行事曆):業務頁,沒有組織治理權限的人也打得開。
 */
export const DayOffOverviewTab = () => {
  const t = useTranslations("admin.schedule.dayOffs");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { session } = useSession();
  const [orgId, setOrgId] = useUrlState("org", orgSchema);
  const [monthParam, setMonth] = useUrlState("month", monthSchema);
  const [filter, setFilter] = useUrlState("dayOffFilter", filterSchema);
  const [overrideDate, setOverrideDate] = useState<string | null>(null);
  const query = useScheduleDayOffOverviewQuery(session.client, {
    input: {
      ...(orgId === "" ? {} : { orgId }),
      ...(isMonth(monthParam) ? { month: monthParam } : {}),
    },
  });
  const overview = query.data?.scheduleDayOffOverview;
  if (overview === undefined) {
    // 載入中留白;查詢失敗要說出來,不能整頁空白
    return query.isError ? (
      <Alert severity="error">{t("loadFailed")}</Alert>
    ) : null;
  }
  const { window, limits } = overview;
  const maxDaily = limits.maxDailyStaff ?? null;
  // 畫休歸屬主要分店:「尚未畫休」只算以這家店為主要分店的人(支援人員不算)
  const notRegistered = overview.staff.filter(
    (item) => item.isPrimary && item.dayOffCount === 0,
  );
  const separator = t("overview.nameSeparator");
  const { year, month } = dateParts(`${overview.month}-01`);

  const linesOf = (day: ScheduleDayOffDayFieldsFragment) => {
    const fullDay = [
      ...new Set(
        day.dayOffs
          .filter((item) => item.kind === "full-day")
          .map((item) => item.name),
      ),
    ];
    return [
      ...(fullDay.length === 0
        ? []
        : [t("overview.cellFullDay", { names: fullDay.join(separator) })]),
      ...day.dayOffs
        .filter((item) => item.kind === "time-range")
        .map((item) =>
          t("overview.cellTimeRange", {
            name: item.name,
            start: item.startTime ?? "",
            end: item.endTime ?? "",
          }),
        ),
    ];
  };

  const dayInfo: Record<string, MonthCalendarDayInfo> = Object.fromEntries(
    overview.days.map((day) => [
      day.date,
      {
        content: (
          <DayOffCellContent
            lines={linesOf(day)}
            {...(maxDaily === null
              ? {}
              : {
                  count: {
                    count: day.staffCount,
                    limit: maxDaily,
                    text: t("count", {
                      count: day.staffCount,
                      limit: maxDaily,
                    }),
                  },
                })}
          />
        ),
      },
    ]),
  );

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" } }}
      >
        <OrgTreeSelect
          scope="visible"
          label={t("overview.org")}
          value={[overview.orgId]}
          size="small"
          onChange={(ids) => {
            setOrgId(ids.at(0) ?? "");
          }}
        />
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <IconButton
            aria-label={t("overview.prevMonth")}
            onClick={() => {
              setMonth(shiftMonth(overview.month, -1));
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="subtitle1">
            {t("monthTitle", { year, month })}
          </Typography>
          <IconButton
            aria-label={t("overview.nextMonth")}
            onClick={() => {
              setMonth(shiftMonth(overview.month, 1));
            }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
        <Stack sx={{ flex: 1 }} />
        {overview.canEdit && (
          <Button
            variant="outlined"
            onClick={() => {
              setOverrideDate("");
            }}
          >
            {t("overview.override")}
          </Button>
        )}
      </Stack>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 0.5, sm: 2 }}
      >
        <Typography variant="subtitle2">
          {t(WINDOW_KEY[window.state] ?? "overview.windowBefore", {
            start: shortDate(window.startDate),
            end: shortDate(window.endDate),
            days: window.daysLeft,
          })}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {notRegistered.length === 0
            ? t("overview.allRegistered")
            : t("overview.notRegistered", {
                count: notRegistered.length,
                names: notRegistered.map((item) => item.name).join(separator),
              })}
        </Typography>
      </Stack>
      <SegmentedControl
        aria-label={t("overview.filterAria")}
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: t("overview.filterAll") },
          {
            value: "not-registered",
            label: t("overview.filterNotRegistered", {
              count: notRegistered.length,
            }),
          },
        ]}
        sx={{ alignSelf: "flex-start" }}
      />
      {filter === "not-registered" ? (
        <Card variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            {notRegistered.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                {t("overview.allRegistered")}
              </Typography>
            ) : (
              notRegistered.map((item) => (
                <Typography key={item.userId} variant="body2">
                  {item.name}
                </Typography>
              ))
            )}
          </Stack>
        </Card>
      ) : (
        <Card variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <MonthCalendar
              month={overview.month}
              showHeader={false}
              selectionMode={overview.canEdit ? "single" : "none"}
              selectedDates={[]}
              onSelectedDatesChange={(dates) => {
                const date = dates.at(0);
                if (date !== undefined) {
                  setOverrideDate(date);
                }
              }}
              days={dayInfo}
              weekdayLabels={[0, 1, 2, 3, 4, 5, 6].map((day) =>
                tCalendar(`weekdays.${String(day)}`),
              )}
            />
            <DayOffLegend variant="overview" />
          </Stack>
        </Card>
      )}
      {overrideDate !== null && (
        <OverrideDayOffDialog
          orgId={overview.orgId}
          staff={overview.staff}
          days={overview.days}
          initialDate={overrideDate}
          reasonRequired={window.state === "closed"}
          onClose={() => {
            setOverrideDate(null);
          }}
        />
      )}
    </Stack>
  );
};
