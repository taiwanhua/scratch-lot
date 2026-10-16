"use client";

import { Box } from "../Box/Box";
import { ScheduleTimelineBackdrop } from "./ScheduleTimelineBackdrop";
import { ScheduleTimelineGroupBox } from "./ScheduleTimelineGroupBox";
import { ScheduleTimelineMore } from "./ScheduleTimelineMore";
import { ScheduleTimelineSlots } from "./ScheduleTimelineSlots";
import { layoutTimeline } from "./layout-timeline";
import type { ScheduleTimelineDate } from "./schedule-timeline-types";
import { WEEK_DAY_HEIGHT, WEEK_HOUR_HEIGHT } from "./timeline-geometry";
import type { TimelineActions } from "./timeline-interaction";
import type { DisabledDayRange, GroupDayModel } from "./timeline-model";
import { hourLinesSx } from "./timeline-styles";

export interface ScheduleTimelineWeekDayProps {
  day: ScheduleTimelineDate;
  models: readonly GroupDayModel[];
  disabledRanges: readonly DisabledDayRange[];
  /** 當天欄寬(px,整數) */
  dayWidth: number;
  actions: TimelineActions;
}

/**
 * 週模式的一天欄:時間由上往下;容器依 `layoutTimeline` 排入,放不下的整個收進最右邊的「+N」長條。
 */
export const ScheduleTimelineWeekDay = ({
  day,
  models,
  disabledRanges,
  dayWidth,
  actions,
}: ScheduleTimelineWeekDayProps) => {
  const { placed, collapsed } = layoutTimeline(models, dayWidth);

  return (
    <Box
      data-timeline-axis="y"
      data-date={day.date}
      sx={(theme) => ({
        position: "relative",
        flexShrink: 0,
        width: dayWidth,
        height: WEEK_DAY_HEIGHT,
        boxSizing: "border-box",
        borderRight: 1,
        borderColor: "divider",
        bgcolor: day.background ?? "background.paper",
        ...hourLinesSx(theme, "y", WEEK_HOUR_HEIGHT),
      })}
    >
      <ScheduleTimelineBackdrop
        orientation="week"
        date={day.date}
        disabledRanges={disabledRanges}
        actions={actions}
      />
      {placed.map(({ group: model, x }) => (
        <ScheduleTimelineGroupBox
          key={model.id}
          orientation="week"
          group={model.group}
          span={model.span}
          date={day.date}
          crossOffset={x}
          actions={actions}
        />
      ))}
      {placed.map(({ group: model, x }) => (
        <ScheduleTimelineSlots
          key={model.id}
          orientation="week"
          model={model}
          date={day.date}
          origin={x}
          actions={actions}
        />
      ))}
      {collapsed.length === 0 ? null : (
        <ScheduleTimelineMore
          date={day.date}
          collapsed={collapsed.map((model) => model.group)}
          dayWidth={dayWidth}
          actions={actions}
        />
      )}
    </Box>
  );
};
