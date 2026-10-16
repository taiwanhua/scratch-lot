"use client";

import { Box } from "../Box/Box";
import { ScheduleTimelineHeaderCell } from "./ScheduleTimelineHeaderCell";
import { ScheduleTimelineWeekDay } from "./ScheduleTimelineWeekDay";
import type { ScheduleTimelineDate } from "./schedule-timeline-types";
import {
  WEEK_DAY_HEIGHT,
  WEEK_HOUR_HEIGHT,
  WEEK_TIME_COLUMN_WIDTH,
} from "./timeline-geometry";
import type { TimelineActions } from "./timeline-interaction";
import type { DisabledDayRange, GroupDayModel } from "./timeline-model";
import { formatMinute } from "./timeline-time";

export interface ScheduleTimelineWeekViewProps {
  dates: readonly ScheduleTimelineDate[];
  /** 與 `dates` 同順序:每天的容器 / 不能操作的範圍 */
  models: readonly (readonly GroupDayModel[])[];
  disabledRanges: readonly (readonly DisabledDayRange[])[];
  dayWidth: number;
  today: string;
  actions: TimelineActions;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** 週模式:7 天各一欄,時間由上往下;表頭(日期)固定在上方、時間欄固定在左邊。 */
export const ScheduleTimelineWeekView = ({
  dates,
  models,
  disabledRanges,
  dayWidth,
  today,
  actions,
}: ScheduleTimelineWeekViewProps) => (
  <Box sx={{ display: "flex", flexDirection: "column", width: "max-content" }}>
    <Box sx={{ display: "flex", position: "sticky", top: 0, zIndex: 5 }}>
      <Box sx={{ position: "sticky", left: 0, zIndex: 1, display: "flex" }}>
        <ScheduleTimelineHeaderCell width={WEEK_TIME_COLUMN_WIDTH} />
      </Box>
      {dates.map((day) => (
        <ScheduleTimelineHeaderCell
          key={day.date}
          width={dayWidth}
          date={day.date}
          isToday={day.date === today}
          label={day.label}
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
          width: WEEK_TIME_COLUMN_WIDTH,
          height: WEEK_DAY_HEIGHT,
          boxSizing: "border-box",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {HOURS.map((hour) => (
          <Box
            key={hour}
            sx={{
              position: "absolute",
              top: hour * WEEK_HOUR_HEIGHT,
              left: 0,
              right: 0,
              px: 0.5,
              typography: "caption",
              color: "text.secondary",
            }}
          >
            {formatMinute(hour * 60)}
          </Box>
        ))}
      </Box>
      {dates.map((day, index) => (
        <ScheduleTimelineWeekDay
          key={day.date}
          day={day}
          models={models[index] ?? []}
          disabledRanges={disabledRanges[index] ?? []}
          dayWidth={dayWidth}
          actions={actions}
        />
      ))}
    </Box>
  </Box>
);
