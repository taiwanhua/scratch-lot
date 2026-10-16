"use client";

import type { SxProps, Theme } from "@mui/material/styles";
import dayjs from "dayjs";
import type { ReactNode } from "react";

import { Box } from "../Box/Box";
import { mergeSx } from "../theme/sx";
import { ScheduleTimelineDayView } from "./ScheduleTimelineDayView";
import { ScheduleTimelineWeekView } from "./ScheduleTimelineWeekView";
import { layoutTimeline } from "./layout-timeline";
import type {
  ScheduleTimelineBar,
  ScheduleTimelineDate,
  ScheduleTimelineDisabledRange,
  ScheduleTimelineGroup,
  ScheduleTimelineMode,
  ScheduleTimelineMoreTone,
  ScheduleTimelinePoint,
  ScheduleTimelineSelection,
  ScheduleTimelineVacancy,
} from "./schedule-timeline-types";
import {
  DAY_HOUR_WIDTH,
  DEFAULT_WEEK_DAY_WIDTH,
  WEEK_HOUR_HEIGHT,
  WEEK_TIME_COLUMN_WIDTH,
} from "./timeline-geometry";
import type { TimelineActions } from "./timeline-interaction";
import {
  disabledRangesOfDay,
  groupsOfDay,
  startMinutesOf,
} from "./timeline-model";
import { initialScrollMinute } from "./timeline-time";
import { useAutoScroll } from "./useAutoScroll";
import { useElementWidth } from "./useElementWidth";
import { useEmptyCellCursor } from "./useEmptyCellCursor";

export type * from "./schedule-timeline-types";

const NO_RANGES: readonly ScheduleTimelineDisabledRange[] = [];
const neutralTone = (): ScheduleTimelineMoreTone => "neutral";
const plusCount = (count: number) => `+${String(count)}`;

export interface ScheduleTimelineProps {
  /** 日模式(一天,時間左→右)/ 週模式(每天一欄,時間上→下) */
  mode: ScheduleTimelineMode;
  /** 顯示的日期,依欄的順序(日模式只用第一天);週的起始日由使用的頁面決定 */
  dates: readonly ScheduleTimelineDate[];
  /** 群組(容器),各帶裡面的長條與缺額空位;跨午夜的兩天各畫一段 */
  groups: readonly ScheduleTimelineGroup[];
  /** 不能操作的時間範圍(灰色;例:店休、已排於其他分店) */
  disabledRanges?: readonly ScheduleTimelineDisabledRange[];
  /** 今天(`YYYY-MM-DD`;預設依瀏覽器時鐘,測試可固定):表頭的日期畫成主色實心圓 */
  today?: string;
  /** 已選取的東西(受控);`null` = 沒有。沒給 = 不追蹤選取,按鈕不標 `aria-pressed` */
  selection?: ScheduleTimelineSelection | null;
  /** 點容器(標題);沒給時容器不可點 */
  onGroupClick?: (
    group: ScheduleTimelineGroup,
    point: ScheduleTimelinePoint,
  ) => void;
  /** 點長條(停用的長條不可點);沒給時長條不可點 */
  onBarClick?: (
    bar: ScheduleTimelineBar,
    group: ScheduleTimelineGroup,
    point: ScheduleTimelinePoint,
  ) => void;
  /** 點缺額空位:另帶群組與空位;沒給時空位不可點 */
  onVacancyClick?: (
    vacancy: ScheduleTimelineVacancy,
    group: ScheduleTimelineGroup,
    point: ScheduleTimelinePoint,
  ) => void;
  /** 點空白處(每小時一格;不能操作的時間不可點);沒給時空白處不可點 */
  onEmptyClick?: (point: ScheduleTimelinePoint) => void;
  /** 空白格滑過時的淡色提示(例:「+ 人力需求」) */
  emptyHint?: string;
  /** 點週模式的「+N」長條:帶日期與被收起的容器(依完整排序) */
  onMoreClick?: (
    date: string,
    collapsed: readonly ScheduleTimelineGroup[],
  ) => void;
  /** 「+N」長條的框色,依被收起的內容決定;預設 neutral */
  getMoreTone?: (
    collapsed: readonly ScheduleTimelineGroup[],
    date: string,
  ) => ScheduleTimelineMoreTone;
  /** 「+N」的文字;預設「+N」 */
  formatMoreLabel?: (count: number) => string;
  /** 跨午夜標示;預設「前日 →」/「→ 次日」 */
  prevDayLabel?: ReactNode;
  nextDayLabel?: ReactNode;
  /** 週模式的一天欄寬(px);沒給就依容器寬平分(量不到時 157) */
  dayWidth?: number;
  /** 疊加到捲動容器上的樣式(給確定的高度,例:`{ height: 640 }`) */
  containerSx?: SxProps<Theme>;
  "aria-label"?: string;
}

/**
 * 時間軸(《底座規格》10.11;Figma BS-22 289:66462、Draft/ScheduleTimeline 289:66461):
 * 時間固定 00:00–24:00、每小時一格,在時間方向捲動、表頭固定。容器模式:每個群組一個容器
 * (底層),裡面放長條與缺額空位;週模式依 `layoutTimeline` 排入、放不下的整個收進「+N」長條,
 * 日模式往下排、不收起。進入畫面(或切換日期 / 週)時自動捲到最早的長條或容器的前 1 小時
 * (沒有資料時 08:00)。點容器 / 長條 / 缺額 / 空白處都回呼(帶點到的日期與時間);
 * hover 提示由模組提供;不做拖拉。期間切換列(含 [今天])由使用的頁面提供,不在本元件內。
 */
export const ScheduleTimeline = ({
  mode,
  dates,
  groups,
  disabledRanges = NO_RANGES,
  today = dayjs().format("YYYY-MM-DD"),
  selection,
  onGroupClick,
  onBarClick,
  onVacancyClick,
  onEmptyClick,
  emptyHint,
  onMoreClick,
  getMoreTone = neutralTone,
  formatMoreLabel = plusCount,
  prevDayLabel = "前日 →",
  nextDayLabel = "→ 次日",
  dayWidth,
  containerSx,
  "aria-label": ariaLabel,
}: ScheduleTimelineProps) => {
  const shown = mode === "day" ? dates.slice(0, 1) : dates;
  const models = shown.map((day) => groupsOfDay(groups, day.date));
  const ranges = shown.map((day) =>
    disabledRangesOfDay(disabledRanges, day.date),
  );
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const weekDayWidth =
    dayWidth ??
    (width > WEEK_TIME_COLUMN_WIDTH
      ? Math.floor((width - WEEK_TIME_COLUMN_WIDTH) / Math.max(shown.length, 1))
      : DEFAULT_WEEK_DAY_WIDTH);
  // 週模式每天的排版(放好的 / 收進「+N」的);自動捲動只看畫得出來的容器
  const layouts = models.map((dayModels) =>
    layoutTimeline(dayModels, weekDayWidth),
  );
  const startMinutes = startMinutesOf(
    mode === "week"
      ? layouts.map((layout) => layout.placed.map((p) => p.group))
      : models,
  );
  const emptyCursor = useEmptyCellCursor({
    mode,
    dates: shown.map((day) => day.date),
    disabledRanges: ranges,
    enabled: onEmptyClick !== undefined,
  });

  useAutoScroll(ref, {
    rangeKey: `${mode}:${shown.map((day) => day.date).join(",")}`,
    hasData: startMinutes.length > 0,
    offset:
      (initialScrollMinute(startMinutes) / 60) *
      (mode === "day" ? DAY_HOUR_WIDTH : WEEK_HOUR_HEIGHT),
    axis: mode === "day" ? "x" : "y",
  });

  const actions: TimelineActions = {
    selection,
    onGroupClick,
    onBarClick,
    onVacancyClick,
    onEmptyClick,
    emptyHint,
    onMoreClick,
    getMoreTone,
    formatMoreLabel,
    prevDayLabel,
    nextDayLabel,
    emptyCursor,
  };
  const firstDay = shown[0];

  return (
    <Box
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      data-mode={mode}
      data-timeline-root=""
      sx={mergeSx(
        {
          position: "relative",
          overflow: "auto",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
        },
        containerSx,
      )}
    >
      {mode === "week" ? (
        <ScheduleTimelineWeekView
          dates={shown}
          layouts={layouts}
          disabledRanges={ranges}
          dayWidth={weekDayWidth}
          today={today}
          actions={actions}
        />
      ) : null}
      {mode === "day" && firstDay !== undefined ? (
        <ScheduleTimelineDayView
          day={firstDay}
          models={models[0] ?? []}
          disabledRanges={ranges[0] ?? []}
          today={today}
          actions={actions}
        />
      ) : null}
    </Box>
  );
};
