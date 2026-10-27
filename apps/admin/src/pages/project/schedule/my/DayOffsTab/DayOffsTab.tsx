import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, parseLocalMonth } from "@repo/domain/form";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import {
  MonthCalendar,
  type MonthCalendarDayInfo,
} from "@repo/ui/month-calendar";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { DayOffCellContent } from "@/components/project/schedule/DayOffs/DayOffCellContent";
import { DayOffDetailDialog } from "@/components/project/schedule/DayOffs/DayOffDetailDialog";
import { DayOffLegend } from "@/components/project/schedule/DayOffs/DayOffLegend";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";
import { dayKeyOf, dayOffBandOf } from "@/lib/project/schedule-day-offs";
import { lastDayShownAt, localPartsOf } from "@/lib/project/schedule-roster";

import { DayOffDialog } from "./DayOffDialog";
import { DayOffViolationsCard } from "./DayOffViolationsCard";
import { DayOffsNotice } from "./DayOffsNotice";
import { useMyDayOffsMonth } from "./useMyDayOffsMonth";

/** 對話框:登記(帶入日期鍵;[登記畫休] 為空字串)或當天詳細。 */
type Opened =
  { mode: "register"; date: string } | { mode: "detail"; date: string };

const MANAGE_MODULE = "schedule.manage";

/** 開放期間的狀態 → 頂部那一句(開放中 / 已結束 / 還沒開始)。 */
const SUMMARY_KEY: Partial<
  Record<string, "my.summaryOpen" | "my.summaryClosed" | "my.summaryBefore">
> = {
  open: "my.summaryOpen",
  closed: "my.summaryClosed",
  before: "my.summaryBefore",
};

/**
 * 我的班表 → 我的畫休(SC-02 開放期間內 / SC-23 開放期間外;規格 14.6)。
 *
 * - 開放期間內畫的是下個月;只有一個 [登記畫休](點日期也會打開,帶入那天);不需核准,違反限制不存
 * - 格子:整天畫休「畫休」、時段不可排「09:00–13:00 不可排」、主要分店的同日畫休人數「2/2」、
 *   我那天有畫休就整格灰色斜線底;違反的日子底部加色帶;ⓘ 看當天誰畫休
 * - 開放期間外:提示不能自己修改;有代改權限的人看到「到畫休總覽代改」(過去的月份 = 早於這個月,
 *   只提示「只能查看」,沒有連結;這個月照舊)
 * - `◀ 2026 年 12 月 ▶` 換月(同班表分頁,月份放網址 `?month=`):往前看過去的月份(api 回
 *   `canEdit=false` → 唯讀,只能看 ⓘ);往後只到目標月
 */
export const DayOffsTab = () => {
  const t = useTranslations("admin.schedule.dayOffs");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const routeOf = useModuleRoutes();
  const text = useTemporalText();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [opened, setOpened] = useState<Opened | null>(null);
  const { query, atTarget, isPast, goMonth } = useMyDayOffsMonth();
  const page = query.data?.myScheduleDayOffs;

  if (page === undefined) {
    // 載入中留白;查詢失敗要說出來,不能整頁空白
    return query.isError ? (
      <Alert severity="error">{t("loadFailed")}</Alert>
    ) : null;
  }
  const { window, limits, violations } = page;
  if (page.primaryOrg === null || window === null || window === undefined) {
    return <Typography color="textSecondary">{t("my.notJoined")}</Typography>;
  }

  const range = {
    start: text(window.from, "monthDay"),
    end: text(lastDayShownAt(window.to), "monthDay"),
  };
  const shownMonth = parseLocalMonth(page.month);
  const monthNumber = shownMonth?.month ?? 0;
  const summary = t(SUMMARY_KEY[window.state] ?? "my.summaryBefore", {
    month: monthNumber,
    ...range,
    days: window.daysLeft,
  });
  const stats = [
    t("my.stats", { count: page.dayOffCount }),
    ...(limits.maxMonthly === null || limits.maxMonthly === undefined
      ? []
      : [t("my.statsMax", { limit: limits.maxMonthly })]),
    ...(limits.minMonthly === null || limits.minMonthly === undefined
      ? []
      : [t("my.statsMin", { limit: limits.minMonthly })]),
  ].join(" · ");
  const manageRoute = routeOf(MANAGE_MODULE);

  const maxDaily = limits.maxDailyStaff ?? null;

  // 月曆格以租戶時區的日期鍵對日子(api 回的是那天 00:00 的時點)
  const keyOf = (value: string) => dayKeyOf(value, timezone);
  const clockOf = (value: string | null | undefined) =>
    value === null || value === undefined
      ? ""
      : localPartsOf(value, timezone).time;
  const dayOn = (date: string) =>
    page.days.find((item) => keyOf(item.date) === date);
  const dayInfo: Record<string, MonthCalendarDayInfo> = {};
  const datesWithDayOffs = new Set([
    ...page.days.map((day) => keyOf(day.date)),
    ...page.myDayOffs.map((item) => keyOf(item.date)),
  ]);
  for (const date of datesWithDayOffs) {
    const mine = page.myDayOffs.filter((item) => keyOf(item.date) === date);
    const day = dayOn(date);
    dayInfo[date] = {
      content: (
        <DayOffCellContent
          lines={mine.map((item) =>
            item.kind === "full-day"
              ? t("cellFullDay")
              : t("cellTimeRange", {
                  start: clockOf(item.startAt),
                  end: clockOf(item.endAt),
                }),
          )}
          hatched={mine.length > 0}
          band={dayOffBandOf(violations, date, timezone)}
          {...(day === undefined || maxDaily === null
            ? {}
            : {
                count: {
                  count: day.staffCount,
                  limit: maxDaily,
                  text: t("count", { count: day.staffCount, limit: maxDaily }),
                },
              })}
          info={{
            label: t("infoAria", {
              date: text(localDayInstantOf(date, timezone), "monthDay"),
            }),
            onClick: () => {
              setOpened({ mode: "detail", date });
            },
          }}
        />
      ),
    };
  }
  // 沒有畫休、但有違反(例:連續上班)的日子也要有色帶
  for (const violation of violations) {
    for (const date of violation.dates.map((value) => keyOf(value))) {
      dayInfo[date] ??= {
        content: (
          <DayOffCellContent
            lines={[]}
            band={dayOffBandOf(violations, date, timezone)}
          />
        ),
      };
    }
  }

  return (
    <Stack spacing={2}>
      <DayOffsNotice
        isPast={isPast}
        state={window.state}
        range={range}
        overrideHref={
          page.canOverride && manageRoute !== null
            ? `${manageRoute}?tab=day-offs&month=${page.month}`
            : null
        }
      />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 0.5, sm: 2 }}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Typography variant="subtitle2">{summary}</Typography>
        <Typography variant="body2" color="textSecondary">
          {stats}
        </Typography>
      </Stack>
      {/* 左右比例只在並排(md 起)時給:直排時 flex-basis 0 會把月曆卡片壓矮、裁掉圖例(STYLE-08) */}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Card variant="outlined" sx={{ p: 2, flex: { md: 2 }, minWidth: 0 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <IconButton
                size="small"
                aria-label={t("my.prevMonth")}
                onClick={() => {
                  goMonth(-1);
                }}
              >
                <ChevronLeftIcon />
              </IconButton>
              <Typography variant="h6" sx={{ whiteSpace: "nowrap" }}>
                {t("monthTitle", {
                  year: shownMonth?.year ?? 0,
                  month: monthNumber,
                })}
              </Typography>
              <IconButton
                size="small"
                aria-label={t("my.nextMonth")}
                disabled={atTarget}
                onClick={() => {
                  goMonth(1);
                }}
              >
                <ChevronRightIcon />
              </IconButton>
              <Stack sx={{ flex: 1 }} />
              {page.canEdit && (
                <Button
                  onClick={() => {
                    setOpened({ mode: "register", date: "" });
                  }}
                >
                  {t("my.register")}
                </Button>
              )}
            </Stack>
            <Box>
              <MonthCalendar
                month={page.month}
                timezone={timezone}
                showHeader={false}
                selectionMode={page.canEdit ? "single" : "none"}
                selectedDates={[]}
                onSelectedDatesChange={(dates) => {
                  const date = dates.at(0);
                  if (date !== undefined) {
                    setOpened({ mode: "register", date });
                  }
                }}
                days={dayInfo}
                weekdayLabels={[0, 1, 2, 3, 4, 5, 6].map((day) =>
                  tCalendar(`weekdays.${String(day)}`),
                )}
              />
            </Box>
            <DayOffLegend variant="mine" />
          </Stack>
        </Card>
        <Box sx={{ flex: { md: 1 }, minWidth: 0 }}>
          <DayOffViolationsCard
            violations={violations}
            onView={(date) => {
              setOpened({ mode: "detail", date });
            }}
          />
        </Box>
      </Stack>
      {opened?.mode === "register" && (
        <DayOffDialog
          initialDate={opened.date}
          month={page.month}
          myDayOffs={page.myDayOffs}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
      {opened?.mode === "detail" && (
        <DayOffDetailDialog
          date={opened.date}
          day={dayOn(opened.date)}
          limit={maxDaily}
          violations={violations}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
    </Stack>
  );
};
