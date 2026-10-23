import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import { useBreakpointDown } from "@repo/ui/media-query";
import {
  MonthCalendar,
  type MonthCalendarDayInfo,
} from "@repo/ui/month-calendar";
import { Stack } from "@repo/ui/stack";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import { ScheduleLegend } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";
import { useTenantToday } from "@/hooks/base/useTenantToday";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import {
  datesOfMonth,
  demandCountsOf,
  localPartsOf,
  monthDayOf,
  weekdayOf,
} from "@/lib/project/schedule-roster";
import type { CountLabels } from "@/lib/project/schedule-roster-views";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import { type RosterData, useRoster } from "../roster-context";
import { MonthDayContent, type MonthDayItem } from "./MonthDayContent";
import { useUnmatchedPunchCounts } from "./unmatched-punches";
import { useShowDay } from "./useRosterDate";

const deviceOf = (isMobile: boolean, isNarrow: boolean) => {
  if (isMobile) {
    return "mobile" as const;
  }
  return isNarrow ? ("tablet" as const) : ("desktop" as const);
};

/** 行事曆:店休停用並寫「店休」;特殊日寫名稱(它的顏色)。 */
const calendarInfoOf = (
  day: RosterData["calendarDays"][number] | undefined,
  closedLabel: string,
): MonthCalendarDayInfo => {
  if (day?.type === "closed") {
    return { disabled: true, disabledReason: closedLabel, note: closedLabel };
  }
  if (day?.type === "special" && isTagPaletteKey(day.paletteKey)) {
    return {
      note: (
        <TagPaletteChip paletteKey={day.paletteKey} label={day.name ?? ""} />
      ),
    };
  }
  return {};
};

/**
 * 月檢視(SC-43;規格 14.5 月):看整體、改人力需求,**不排班**。底座 `MonthCalendar`,每天放各人力需求的
 * 摘要標籤(寫法依裝置,見「人數寫法」;手機每筆一顆實心點),不放人名(人名在滑過提示);同一週依那週最多的一天
 * 自動長高,格子內不捲動。店休停用、特殊日寫名稱;未對應排班的打卡右上角 ⏲(資料由打卡功能提供)。
 *
 * - 點標籤 → 人力需求對話框;點空白處 → 新增人力需求(帶入日期);點日期數字 → 切到那天的日檢視
 * - 手機:點日期 → 那天的日檢視
 */
export const MonthView = () => {
  const t = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { data, timezone } = useRoster();
  const isMobile = useBreakpointDown("sm");
  const isNarrow = useBreakpointDown("lg");
  const device = deviceOf(isMobile, isNarrow);
  const showDay = useShowDay();
  const today = useTenantToday();
  const punches = useUnmatchedPunchCounts(data.orgId, data.month);
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const labels: CountLabels = {
    short: { leader: t("count.leader"), helper: t("count.helper") },
    long: { leader: t("cell.roles.leader"), helper: t("cell.roles.helper") },
  };
  const templateById = new Map(data.templates.map((item) => [item.id, item]));
  const calendarByDate = new Map(
    data.calendarDays.map((day) => [day.date, day]),
  );
  const time = (iso: string) => localPartsOf(iso, timezone).time;

  const itemsOf = (date: string): MonthDayItem[] => {
    const demands = data.demands
      .filter((demand) => demand.date === date)
      .toSorted(
        (left, right) =>
          Date.parse(left.startAt) - Date.parse(right.startAt) ||
          Date.parse(left.createdAt) - Date.parse(right.createdAt),
      );
    return demands.map((demand) => {
      const template =
        demand.templateId === null || demand.templateId === undefined
          ? undefined
          : templateById.get(demand.templateId);
      const sameTemplate = demands.filter(
        (other) => (other.templateId ?? null) === (demand.templateId ?? null),
      ).length;
      return {
        demand,
        showPosition: template !== undefined && sameTemplate > 1,
        names: demand.tasks.flatMap((task) =>
          task.userName === null || task.userName === undefined
            ? []
            : [task.userName],
        ),
        wording: {
          shortName: template?.shortName ?? t("tempRow"),
          name: template?.name ?? t("tempRow"),
          time: t("cell.range", {
            start: time(demand.startAt),
            end: time(demand.endAt),
          }),
          position: [positions.labelOf(demand.positionKey), demand.positionNote]
            .filter(
              (part) => part !== null && part !== undefined && part !== "",
            )
            .join(" · "),
          counts: demandCountsOf(demand.tasks),
        },
      };
    });
  };

  const days: Record<string, MonthCalendarDayInfo> = {};
  for (const date of datesOfMonth(data.month)) {
    const info = calendarInfoOf(calendarByDate.get(date), t("cell.closed"));
    days[date] = {
      ...info,
      content:
        info.disabled === true ? null : (
          <MonthDayContent
            date={date}
            items={itemsOf(date)}
            device={device}
            labels={labels}
            punchCount={punches.get(date) ?? 0}
          />
        ),
    };
  }

  return (
    // 寬度由外層給:不讓時間軸 / 月曆的內容寬撐開頁面(時間軸依量到的寬度排版)
    <Stack spacing={1.5} sx={{ minWidth: 0, contain: "inline-size" }}>
      <Stack sx={{ overflowX: "auto" }}>
        <MonthCalendar
          month={data.month}
          timezone={timezone}
          showHeader={false}
          // 點日期數字(格子裡標籤與空白處以外的地方)→ 那天的日檢視;手機點日期同
          selectionMode="single"
          selectedDates={[]}
          onSelectedDatesChange={(dates) => {
            const picked = dates.at(0);
            if (picked !== undefined) {
              showDay(picked);
            }
          }}
          days={days}
          today={today}
          weekdayLabels={Array.from({ length: 7 }, (_, index) =>
            tCalendar(`weekdays.${String(index)}`),
          )}
          formatDayLabel={(date) =>
            t("timeline.monthDayAria", {
              date: t("dateTitle", {
                date: monthDayOf(date, timezone),
                weekday: tCalendar(`weekdays.${String(weekdayOf(date))}`),
              }),
            })
          }
          aria-label={t("timeline.monthAria")}
          sx={{ minWidth: { xs: 0, sm: 640 } }}
        />
      </Stack>
      <ScheduleLegend
        items={
          isMobile
            ? [
                "dotFull",
                "dotMissingHelper",
                "dotMissingLeader",
                "closed",
                "special",
                "unmatchedPunch",
              ]
            : [
                "full",
                "missingHelper",
                "missingLeader",
                "closed",
                "special",
                "unmatchedPunch",
                "temp",
              ]
        }
      />
    </Stack>
  );
};
