"use client";

import { Box } from "../Box/Box";
import { Tooltip } from "../Tooltip/Tooltip";
import { stateLayerSx } from "../theme/state-layer";
import {
  TIMELINE_GROUP_TITLE_WIDTH,
  timelineGroupWidth,
} from "./layout-timeline";
import type { ScheduleTimelineGroup } from "./schedule-timeline-types";
import {
  DAY_GROUP_PADDING_Y,
  dayGroupHeight,
  dayX,
  weekY,
} from "./timeline-geometry";
import {
  type TimelineActions,
  activationProps,
  isSelected,
  pressedOf,
} from "./timeline-interaction";
import {
  captionStrongSx,
  ellipsisSx,
  groupToneColors,
} from "./timeline-styles";
import { type DaySpan, formatTimeRange } from "./timeline-time";

export interface ScheduleTimelineGroupBoxProps {
  orientation: "day" | "week";
  group: ScheduleTimelineGroup;
  span: DaySpan;
  date: string;
  /** 和時間垂直方向的位置(px):日模式是列的上緣、週模式是 `layoutTimeline` 排出的左緣 */
  crossOffset: number;
  actions: TimelineActions;
}

/**
 * 容器(Figma Draft/ScheduleTimelineDemand):一個群組(例:一筆時段需求)的底層,
 * 比裡面所有長條大一點;標題由模組提供(日模式一行、週模式左側 20px 直排)。框色依 Tone。
 * 點容器(標題)回呼模組;互動狀態是白底元件那組(疊 grey/500)。
 */
export const ScheduleTimelineGroupBox = ({
  orientation,
  group,
  span,
  date,
  crossOffset,
  actions,
}: ScheduleTimelineGroupBoxProps) => {
  const isWeek = orientation === "week";
  const tone = groupToneColors(group.tone ?? "neutral");
  const onGroupClick = actions.onGroupClick;
  const selected = isSelected(actions.selection, "group", group.id);
  const slots = group.slots.length;
  const geometry = isWeek
    ? {
        top: weekY(span.startMinute),
        height: weekY(span.endMinute) - weekY(span.startMinute),
        left: crossOffset,
        width: timelineGroupWidth(slots),
      }
    : {
        left: dayX(span.startMinute),
        width: dayX(span.endMinute) - dayX(span.startMinute),
        top: crossOffset,
        height: dayGroupHeight(slots),
      };
  const fallbackLabel =
    typeof group.title === "string"
      ? group.title
      : formatTimeRange(group.start, group.end);

  return (
    <Tooltip title={group.tooltip}>
      <Box
        data-timeline-part="group"
        data-selected={selected || undefined}
        {...(onGroupClick === undefined
          ? {}
          : activationProps({
              label: group.ariaLabel ?? fallbackLabel,
              selected: pressedOf(actions, selected),
              date,
              range: { start: span.startMinute, end: span.endMinute },
              onActivate: (point) => {
                onGroupClick(group, point);
              },
            }))}
        sx={(theme) => ({
          position: "absolute",
          ...geometry,
          zIndex: 2,
          boxSizing: "border-box",
          bgcolor: "background.default",
          border: 1,
          borderColor: tone.border,
          borderRadius: 1,
          overflow: "hidden",
          outline: "none",
          ...(isWeek
            ? { pt: 0.5 }
            : { px: 1, py: `${String(DAY_GROUP_PADDING_Y)}px` }),
          ...(onGroupClick === undefined
            ? { cursor: "default" }
            : stateLayerSx(theme, { selected })),
        })}
      >
        {isWeek ? (
          <Box
            sx={{
              width: TIMELINE_GROUP_TITLE_WIDTH,
              typography: "caption",
              color: tone.text,
              textAlign: "center",
              wordBreak: "break-all",
            }}
          >
            {group.shortTitle ?? group.title}
          </Box>
        ) : (
          <Box sx={{ ...captionStrongSx, ...ellipsisSx, color: tone.text }}>
            {span.fromPrevDay ? <>{actions.prevDayLabel} </> : null}
            {group.title}
            {span.toNextDay ? <> {actions.nextDayLabel}</> : null}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
};
