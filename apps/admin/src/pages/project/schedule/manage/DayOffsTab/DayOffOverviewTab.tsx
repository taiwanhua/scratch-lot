import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  DEFAULT_TENANT_TIMEZONE,
  addLocalMonths,
  localMonthText,
  parseLocalMonth,
} from "@repo/domain/form";
import {
  type ScheduleDayOffDayFieldsFragment,
  type ScheduleDayOffFieldsFragment,
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
import { DayOffDetailDialog } from "@/components/project/schedule/DayOffs/DayOffDetailDialog";
import { DayOffLegend } from "@/components/project/schedule/DayOffs/DayOffLegend";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  dayKeyOf,
  isPastDayOffMonth,
  monthRangeOf,
} from "@/lib/project/schedule-day-offs";
import { lastDayShownAt, localPartsOf } from "@/lib/project/schedule-roster";

import { DeleteDayOffDialog } from "./DeleteDayOffDialog";
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
 * 篩選 [全部] [尚未畫休]。點日期 → 當天畫休(`DayOffDetailDialog`,看得到總覽的人都能看)。
 * 有 `edit-day-offs` 才看得到 [代改](SC-24,只做新增)與當天畫休裡每筆旁邊的 [刪除](先確認,
 * 截止後在確認框選原因)、下方 [代改](帶入那天)。過去的月份(早於這個月)上方與當天畫休都不顯示 [代改]。
 *
 * 分店選擇器是可見範圍模式(`scope="visible"`,同行事曆):業務頁,沒有組織治理權限的人也打得開。
 */
export const DayOffOverviewTab = () => {
  const t = useTranslations("admin.schedule.dayOffs");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { session } = useSession();
  const text = useTemporalText();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [orgId, setOrgId] = useUrlState("org", orgSchema);
  const [monthParam, setMonth] = useUrlState("month", monthSchema);
  const [filter, setFilter] = useUrlState("dayOffFilter", filterSchema);
  const [overrideDate, setOverrideDate] = useState<string | null>(null);
  /** 點日期打開的「當天畫休」(日期鍵) */
  const [openedDate, setOpenedDate] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScheduleDayOffFieldsFragment | null>(
    null,
  );
  // 月份查詢送那個月在租戶時區的時點區間;沒指定 = 目標月(api 決定)
  const range = monthRangeOf(monthParam, timezone);
  const query = useScheduleDayOffOverviewQuery(session.client, {
    input: {
      ...(orgId === "" ? {} : { orgId }),
      ...range,
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
  const shown = parseLocalMonth(overview.month);
  const { year, month } = shown ?? { year: 0, month: 0 };
  const goMonth = (delta: number) => {
    if (shown !== null) {
      setMonth(localMonthText(addLocalMonths(shown, delta)));
    }
  };
  const keyOf = (value: string) => dayKeyOf(value, timezone);
  const clockOf = (value: string | null | undefined) =>
    value === null || value === undefined
      ? ""
      : localPartsOf(value, timezone).time;
  /** 過去的月份(早於這個月):不顯示 [代改](上方與當天畫休;刪除照 api 的規則,不另擋) */
  const isPast = isPastDayOffMonth(overview.month, overview.targetMonth);

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
            start: clockOf(item.startAt),
            end: clockOf(item.endAt),
          }),
        ),
    ];
  };

  const dayInfo: Record<string, MonthCalendarDayInfo> = Object.fromEntries(
    overview.days.map((day) => [
      keyOf(day.date),
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
              goMonth(-1);
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
              goMonth(1);
            }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
        <Stack sx={{ flex: 1 }} />
        {overview.canEdit && !isPast && (
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
            start: text(window.from, "monthDay"),
            end: text(lastDayShownAt(window.to), "monthDay"),
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
              timezone={timezone}
              showHeader={false}
              selectionMode="single"
              selectedDates={[]}
              onSelectedDatesChange={(dates) => {
                const date = dates.at(0);
                if (date !== undefined) {
                  setOpenedDate(date);
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
      {openedDate !== null && (
        <DayOffDetailDialog
          date={openedDate}
          day={overview.days.find((day) => keyOf(day.date) === openedDate)}
          limit={maxDaily}
          // 沒有代改權限 = 唯讀(沒有 [刪除]、[代改])
          {...(overview.canEdit ? { onDelete: setDeleting } : {})}
          {...(overview.canEdit && !isPast
            ? {
                extraActions: (
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setOverrideDate(openedDate);
                      setOpenedDate(null);
                    }}
                  >
                    {t("overview.override")}
                  </Button>
                ),
              }
            : {})}
          onClose={() => {
            setOpenedDate(null);
          }}
        />
      )}
      {deleting !== null && (
        <DeleteDayOffDialog
          orgId={overview.orgId}
          item={deleting}
          reasonRequired={window.state === "closed"}
          onClose={() => {
            setDeleting(null);
          }}
        />
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
