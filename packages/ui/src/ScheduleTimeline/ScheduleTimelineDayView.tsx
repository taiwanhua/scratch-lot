"use client";

import { Box } from "../Box/Box";
import { ScheduleTimelineBackdrop } from "./ScheduleTimelineBackdrop";
import { ScheduleTimelineGroupBox } from "./ScheduleTimelineGroupBox";
import { ScheduleTimelineHeaderCell } from "./ScheduleTimelineHeaderCell";
import { ScheduleTimelineSlots } from "./ScheduleTimelineSlots";
import type { ScheduleTimelineDate } from "./schedule-timeline-types";
import {
  DAY_DATE_COLUMN_WIDTH,
  DAY_HOUR_WIDTH,
  DAY_LANE_GAP,
  DAY_TRACK_WIDTH,
  dayGroupHeight,
} from "./timeline-geometry";
import type { TimelineActions } from "./timeline-interaction";
import {
  type DisabledDayRange,
  type GroupDayModel,
  dayLanes,
} from "./timeline-model";
import { hourLinesSx } from "./timeline-styles";
import { formatMinute } from "./timeline-time";

export interface ScheduleTimelineDayViewProps {
  day: ScheduleTimelineDate;
  models: readonly GroupDayModel[];
  disabledRanges: readonly DisabledDayRange[];
  today: string;
  actions: TimelineActions;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** 沒有容器時軌道的最小高度(空白處仍可點) */
const MIN_TRACK_HEIGHT = 160;
const HINT_ROW_HEIGHT = 24;

/** 每列的上緣與總高:列高 = 列內最高的容器,列與列之間留間距。 */
const laneTops = (lanes: readonly (readonly GroupDayModel[])[]) => {
  const tops: number[] = [];
  let y = DAY_LANE_GAP;
  for (const lane of lanes) {
    tops.push(y);
    y +=
      Math.max(...lane.map((model) => dayGroupHeight(model.slots))) +
      DAY_LANE_GAP;
  }
  // 最下方多留一列給空白處的「+ 新增」提示(滑過時才顯示,不會被容器蓋住)
  return { tops, height: Math.max(y + HINT_ROW_HEIGHT, MIN_TRACK_HEIGHT) };
};

/**
 * 日模式:一天,時間由左往右;容器往下排、往下長,不收起任何東西(時間不重疊的容器共用一列)。
 * 寬度不足時橫向捲動,表頭(時間)固定在上方、日期欄固定在左邊。
 */
export const ScheduleTimelineDayView = ({
  day,
  models,
  disabledRanges,
  today,
  actions,
}: ScheduleTimelineDayViewProps) => {
  const lanes = dayLanes(models);
  const { tops, height } = laneTops(lanes);

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", width: "max-content" }}
    >
      <Box sx={{ display: "flex", position: "sticky", top: 0, zIndex: 5 }}>
        <Box sx={{ position: "sticky", left: 0, zIndex: 1, display: "flex" }}>
          <ScheduleTimelineHeaderCell
            width={DAY_DATE_COLUMN_WIDTH}
            date={day.date}
            isToday={day.date === today}
            label={day.label}
          />
        </Box>
        {HOURS.map((hour) => (
          <ScheduleTimelineHeaderCell
            key={hour}
            width={DAY_HOUR_WIDTH}
            label={formatMinute(hour * 60)}
          />
        ))}
      </Box>
      <Box sx={{ display: "flex" }}>
        <Box
          aria-hidden
          sx={{
            position: "sticky",
            left: 0,
            zIndex: 4,
            flexShrink: 0,
            width: DAY_DATE_COLUMN_WIDTH,
            boxSizing: "border-box",
            borderRight: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        />
        <Box
          data-timeline-axis="x"
          data-date={day.date}
          sx={(theme) => ({
            position: "relative",
            flexShrink: 0,
            width: DAY_TRACK_WIDTH,
            height,
            bgcolor: day.background ?? "background.paper",
            ...hourLinesSx(theme, "x", DAY_HOUR_WIDTH),
          })}
        >
          <ScheduleTimelineBackdrop
            orientation="day"
            date={day.date}
            disabledRanges={disabledRanges}
            actions={actions}
          />
          {lanes.flatMap((lane, laneIndex) =>
            lane.map((model) => (
              <ScheduleTimelineGroupBox
                key={model.id}
                orientation="day"
                group={model.group}
                span={model.span}
                date={day.date}
                crossOffset={tops[laneIndex] ?? 0}
                actions={actions}
              />
            )),
          )}
          {lanes.flatMap((lane, laneIndex) =>
            lane.map((model) => (
              <ScheduleTimelineSlots
                key={model.id}
                orientation="day"
                model={model}
                date={day.date}
                origin={tops[laneIndex] ?? 0}
                actions={actions}
              />
            )),
          )}
        </Box>
      </Box>
    </Box>
  );
};
