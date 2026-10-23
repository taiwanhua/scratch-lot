import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { parseLocalMonth } from "@repo/domain/form";
import { isIsoMonth } from "@repo/domain/project/schedule-settings";
import { useMyScheduleQuery } from "@repo/graphql";
import { Card } from "@repo/ui/card";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ScheduleLegend } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";
import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  newChangeIdsOf,
  readLastVisit,
  writeLastVisit,
} from "@/lib/project/schedule-my";
import { shiftMonthOf } from "@/lib/project/schedule-roster";

import { ChangesBanner } from "./ChangesBanner";
import { DayDetailDialog } from "./DayDetailDialog";
import { IncompletePunchAlert } from "./IncompletePunchAlert";
import { MyMonthCalendar } from "./MyMonthCalendar";
import { MyScheduleList } from "./MyScheduleList";
import { PunchArea } from "./PunchArea";

/** `?month=YYYY-MM`:顯示的月份;空字串 = 今天所在的月份。 */
const MONTH_SCHEMA = z.string().default("");
/** `?view=calendar|list`:空字串 = 依裝置(電腦 / 平板月曆、手機條列)。 */
const VIEW_SCHEMA = z.enum(["", "calendar", "list"]).default("");

type View = "calendar" | "list";

/** `[月曆 | 條列]` 的寬度(兩個選項;底座 `SegmentedControl` 預設撐滿,先例 `RosterToolbar`)。 */
const VIEW_TOGGLE_WIDTH = 144;

/** 「上次打開這一頁」的時間:進頁時讀一次舊值(判斷「新」),再記下這次的時間。 */
const useLastVisit = (): string | null => {
  const me = useMe().data?.me.id ?? null;
  const [previous] = useState(() => (me === null ? null : readLastVisit(me)));
  useEffect(() => {
    if (me !== null) {
      writeLastVisit(me, new Date().toISOString());
    }
  }, [me]);
  return previous;
};

/**
 * 我的班表 → 班表分頁(SC-01;規格 14.6):以人為單位、跨分店合併、只顯示已發布的班。
 *
 * - 上方:最近異動橫幅(有異動才出現)
 * - 左欄:打卡不完整提醒、打卡區(今天的班 + 昨天未打下班卡的班、「沒有排班」)
 * - 右欄:`◀ 2026 年 11 月 ▶`(月份放網址 `?month=`)與 `[月曆 | 條列]`(網址 `?view=`;
 *   電腦 / 平板預設月曆、手機預設條列);點一天 → 當天詳情
 * - 平板 / 手機:單欄,打卡在上、月曆 / 條列在下
 */
export const ScheduleTab = () => {
  const t = useTranslations("admin.schedule.mySchedule");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const [monthParam, setMonth] = useUrlState("month", MONTH_SCHEMA);
  const [viewParam, setView] = useUrlState("view", VIEW_SCHEMA);
  const [openedDay, setOpenedDay] = useState<string | null>(null);
  const lastVisit = useLastVisit();
  const query = useMyScheduleQuery(session.client, {
    input: isIsoMonth(monthParam) ? { month: monthParam } : null,
  });
  const page = query.data?.mySchedule;
  if (page === undefined) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("loading")}
      </Typography>
    );
  }

  const deviceView: View = isMobile ? "list" : "calendar";
  const view: View = viewParam === "" ? deviceView : viewParam;
  const { year, month } = parseLocalMonth(page.month) ?? { year: 0, month: 0 };
  const changedDates = new Set(
    page.changes
      .filter((change) => change.date.startsWith(`${page.month}-`))
      .map((change) => change.date),
  );
  const goMonth = (delta: number) => {
    setMonth(shiftMonthOf(page.month, delta));
  };

  return (
    <Stack spacing={2}>
      <ChangesBanner
        changes={page.changes}
        newIds={newChangeIdsOf(page.changes, lastVisit)}
      />
      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        sx={{ alignItems: { lg: "flex-start" } }}
      >
        <Stack spacing={1.5} sx={{ width: { lg: 400 }, flexShrink: 0 }}>
          <IncompletePunchAlert entries={page.incomplete} />
          <PunchArea page={page} />
        </Stack>
        <Card variant="outlined" sx={{ p: 2, flex: 1, minWidth: 0 }}>
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <IconButton
                size="small"
                aria-label={t("calendar.prevMonth")}
                onClick={() => {
                  goMonth(-1);
                }}
              >
                <ChevronLeftIcon />
              </IconButton>
              <Typography variant="h6" sx={{ whiteSpace: "nowrap" }}>
                {t("calendar.title", { year, month })}
              </Typography>
              <IconButton
                size="small"
                aria-label={t("calendar.nextMonth")}
                onClick={() => {
                  goMonth(1);
                }}
              >
                <ChevronRightIcon />
              </IconButton>
              <Stack sx={{ flex: 1 }} />
              <SegmentedControl<View>
                aria-label={t("calendar.viewAria")}
                value={view}
                onChange={setView}
                options={[
                  { value: "calendar", label: t("calendar.viewCalendar") },
                  { value: "list", label: t("calendar.viewList") },
                ]}
                sx={{ width: VIEW_TOGGLE_WIDTH, flex: "none" }}
              />
            </Stack>
            {view === "calendar" ? (
              <MyMonthCalendar
                page={page}
                changedDates={changedDates}
                onOpenDay={setOpenedDay}
              />
            ) : (
              <MyScheduleList
                page={page}
                changedDates={changedDates}
                onOpenDay={setOpenedDay}
              />
            )}
            <ScheduleLegend
              items={[
                "leader",
                "temp",
                "dayOff",
                "punchTimes",
                "changedDot",
                "missingDot",
                "special",
              ]}
            />
          </Stack>
        </Card>
      </Stack>
      {openedDay !== null && (
        <DayDetailDialog
          date={openedDay}
          entries={page.entries.filter((entry) => entry.date === openedDay)}
          isDayOff={page.dayOffDates.includes(openedDay)}
          onClose={() => {
            setOpenedDay(null);
          }}
        />
      )}
    </Stack>
  );
};
