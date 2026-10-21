import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { useBreakpointDown } from "@repo/ui/media-query";
import {
  ScheduleTimeline,
  type ScheduleTimelineGroup,
} from "@repo/ui/schedule-timeline";
import { Stack } from "@repo/ui/stack";

import { tagPaletteBackgroundVarsSx } from "@/components/project/TagPaletteChip/tag-palette-background";
import { ScheduleLegend } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";
import { moreToneOf, weekDatesOf } from "@/lib/project/schedule-roster-views";

import { useRoster } from "../roster-context";
import { WeekMobileList } from "./WeekMobileList";
import { WeekMoreList } from "./WeekMoreList";
import { useRosterDate } from "./useRosterDate";
import {
  type RosterTimelineGroup,
  useTimelineGroups,
} from "./useTimelineGroups";

/**
 * 週檢視的時間軸最窄的寬(px):時間欄 48 + 7 天 × 平板設計欄寬 125(Figma SC-44 平板;STYLE-06)。
 * 比這窄(平板、檢核面板打開)時不再擠欄寬,改在外層區塊內左右捲動。
 */
const TIMELINE_MIN_WIDTH = 48 + 7 * 125;

/** 週檢視的時間軸高度(版面由殼給,時間軸自己捲)。 */
const TIMELINE_SX = {
  height: { xs: "60vh", md: "calc(100vh - 340px)" },
  minHeight: 360,
  minWidth: TIMELINE_MIN_WIDTH,
};

const isRosterGroup = (
  group: ScheduleTimelineGroup,
): group is RosterTimelineGroup => "plan" in group;

/**
 * 週檢視(SC-44、SC-60、SC-60b、SC-62;規格 14.5 週):底座 `ScheduleTimeline` 週模式,7 天各一欄,
 * 每筆人力需求一個容器(直排簡寫「早 3/3」),放不下的整筆收進「+N」長條(排版只用底座 `layoutTimeline`)。
 *
 * - 點容器標題 → 人力需求對話框;點長條 → 排班對話框;點缺額 → 新增排班(帶好那筆人力需求與執行任務);
 *   點空白處 → 新增人力需求(帶入日期與時間);「+N」→ 清單浮層
 * - 手機:7 天清單(`WeekMobileList`)
 * - 檢核 [查看] 的目標不在這一週 → 切到那一週
 */
export const WeekView = () => {
  const t = useTranslations("admin.schedule.roster");
  const { data, canEdit, openDemand, openEntry, scrollTarget } = useRoster();
  const isMobile = useBreakpointDown("sm");
  const { date, today, goTo } = useRosterDate(data.month);
  const dates = weekDatesOf(date);
  const timeline = useTimelineGroups(dates, "week");
  const [more, setMore] = useState<{
    date: string;
    groups: RosterTimelineGroup[];
    anchor: { top: number; left: number };
  } | null>(null);
  const pointer = useRef({ top: 0, left: 0 });

  // 檢核 [查看]:目標日期不在這一週 → 切到那一週(格子畫出來後頁殼捲過去)
  const targetDate = scrollTarget?.date ?? null;
  useEffect(() => {
    if (targetDate !== null && !weekDatesOf(date).includes(targetDate)) {
      goTo(targetDate);
    }
  }, [targetDate, date, goTo]);

  if (isMobile) {
    return <WeekMobileList dates={dates} />;
  }

  return (
    // 寬度由外層給:不讓時間軸 / 月曆的內容寬撐開頁面(時間軸依量到的寬度排版)
    <Stack
      spacing={1.5}
      sx={[{ minWidth: 0, contain: "inline-size" }, tagPaletteBackgroundVarsSx]}
    >
      {/* 時間軸在自己的區塊內左右捲動,不把卡片撐寬 */}
      <Box
        onPointerDownCapture={(event) => {
          pointer.current = { top: event.clientY, left: event.clientX };
        }}
        sx={{ minWidth: 0, overflowX: "auto" }}
      >
        <ScheduleTimeline
          mode="week"
          aria-label={t("timeline.weekAria")}
          dates={timeline.dates}
          groups={timeline.groups}
          disabledRanges={timeline.disabledRanges}
          today={today}
          onGroupClick={(group) => {
            const demand = timeline.demandOfGroup(group.id);
            if (demand !== undefined) {
              openDemand(demand);
            }
          }}
          onBarClick={(bar) => {
            const entry = timeline.entryOfSlot(bar.id);
            if (entry !== undefined) {
              openEntry(entry);
            }
          }}
          {...(canEdit
            ? {
                onVacancyClick: (vacancy) => {
                  const preset = timeline.vacancyPresetOf(vacancy.id);
                  if (preset !== undefined) {
                    openEntry(preset);
                  }
                },
                onEmptyClick: (point) => {
                  openDemand({ date: point.date, startTime: point.time });
                },
                emptyHint: t("addDemandHint"),
              }
            : {})}
          onMoreClick={(moreDate, collapsed) => {
            const active = globalThis.document.activeElement;
            const rect =
              pointer.current.top === 0 && active instanceof HTMLElement
                ? active.getBoundingClientRect()
                : null;
            setMore({
              date: moreDate,
              groups: collapsed.filter(isRosterGroup),
              anchor:
                rect === null
                  ? pointer.current
                  : { top: rect.top, left: rect.left },
            });
          }}
          getMoreTone={(collapsed) =>
            moreToneOf(
              collapsed.filter(isRosterGroup).map((group) => group.plan.tone),
            )
          }
          formatMoreLabel={(count) => t("timeline.moreLabel", { count })}
          prevDayLabel={t("timeline.prevDay")}
          nextDayLabel={t("timeline.nextDay")}
          containerSx={TIMELINE_SX}
        />
      </Box>
      <ScheduleLegend
        items={[
          "leader",
          "entry",
          "auto",
          "multi",
          "breakMinutes",
          "special",
          "extension",
          "vacancyLeader",
          "vacancyHelper",
          "moreNeutral",
          "moreWarning",
          "moreError",
        ]}
      />
      {more !== null && (
        <WeekMoreList
          date={more.date}
          groups={more.groups}
          anchor={more.anchor}
          labels={timeline.labels}
          onClose={() => {
            setMore(null);
          }}
        />
      )}
    </Stack>
  );
};
