import { useEffect } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { useBreakpointDown } from "@repo/ui/media-query";
import { ScheduleTimeline } from "@repo/ui/schedule-timeline";
import { Stack } from "@repo/ui/stack";

import { tagPaletteBackgroundVarsSx } from "@/components/project/TagPaletteChip/tag-palette-background";
import { ScheduleLegend } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";
import { useFitMainHeight } from "@/hooks/base/useFitMainHeight";

import { ROSTER_CONTENT_SELECTOR } from "../check-panel/RosterCheckLayout";
import { useRoster } from "../roster-context";
import { DayMobileCards } from "./DayMobileCards";
import { useRosterDate } from "./useRosterDate";
import { useTimelineGroups } from "./useTimelineGroups";

/**
 * 日檢視(SC-45、SC-46;規格 14.5 日):底座 `ScheduleTimeline` 日模式,每筆人力需求一個容器,
 * 依時間由左往右,重疊的容器往下排、不收起;點擊同週檢視。
 * 手機:人力需求卡片清單(`DayMobileCards`)。日期在網址 `?date=`;檢核 [查看] 的目標不是這一天 → 切到那一天。
 */
export const DayView = () => {
  const t = useTranslations("admin.schedule.roster");
  const { data, timezone, canEdit, openDemand, openEntry, scrollTarget } =
    useRoster();
  const isMobile = useBreakpointDown("sm");
  const { date, today, goTo } = useRosterDate(data.month);
  const timeline = useTimelineGroups([date], "day");
  // 時間軸依內容長高,上限 = <main> 扣掉工具列與圖例後剩下的(超過時自己捲)
  const [fitHeight, setFitTarget] = useFitMainHeight({
    boundarySelector: ROSTER_CONTENT_SELECTOR,
  });

  const targetDate = scrollTarget?.date ?? null;
  useEffect(() => {
    if (targetDate !== null && targetDate !== date) {
      goTo(targetDate);
    }
  }, [targetDate, date, goTo]);

  if (isMobile) {
    return <DayMobileCards date={date} timeline={timeline} />;
  }

  return (
    // 寬度由外層給:不讓時間軸 / 月曆的內容寬撐開頁面(時間軸依量到的寬度排版)
    <Stack
      spacing={1.5}
      sx={[{ minWidth: 0, contain: "inline-size" }, tagPaletteBackgroundVarsSx]}
    >
      <Box ref={setFitTarget}>
        <ScheduleTimeline
          mode="day"
          aria-label={t("timeline.dayAria")}
          dates={timeline.dates}
          groups={timeline.groups}
          disabledRanges={timeline.disabledRanges}
          today={today}
          timezone={timezone}
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
          prevDayLabel={t("timeline.prevDay")}
          nextDayLabel={t("timeline.nextDay")}
          containerSx={fitHeight === null ? {} : { maxHeight: fitHeight }}
        />
      </Box>
      <ScheduleLegend
        items={[
          "leader",
          "entry",
          "auto",
          "multi",
          "breakMinutes",
          "extension",
          "vacancyLeader",
          "vacancyHelper",
        ]}
      />
    </Stack>
  );
};
