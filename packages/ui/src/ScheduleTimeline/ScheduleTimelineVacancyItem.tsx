"use client";

import { Box } from "../Box/Box";
import { Tooltip } from "../Tooltip/Tooltip";
import { stateLayerSx } from "../theme/state-layer";
import type {
  ScheduleTimelineGroup,
  ScheduleTimelineVacancy,
} from "./schedule-timeline-types";
import {
  DAY_BAR_HEIGHT,
  WEEK_BAR_WIDTH,
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
  barToneColors,
  captionStrongSx,
  ellipsisSx,
  verticalTextSx,
} from "./timeline-styles";
import type { DaySpan } from "./timeline-time";

export interface ScheduleTimelineVacancyItemProps {
  orientation: "day" | "week";
  vacancy: ScheduleTimelineVacancy;
  group: ScheduleTimelineGroup;
  groupSpan: DaySpan;
  date: string;
  /** 和時間垂直方向的位置(px):日模式是上緣、週模式是左緣 */
  crossOffset: number;
  actions: TimelineActions;
}

/**
 * 缺額虛線空位(Figma Draft/ScheduleTimelineBlock 的 MissingLead / MissingHelper):佔一條、
 * 時段 = 所屬容器;兩種強度(錯誤色 / 警告色)。點了回呼模組,帶出群組與空位。
 */
export const ScheduleTimelineVacancyItem = ({
  orientation,
  vacancy,
  group,
  groupSpan,
  date,
  crossOffset,
  actions,
}: ScheduleTimelineVacancyItemProps) => {
  const isWeek = orientation === "week";
  const tone = barToneColors(vacancy.severity);
  const onVacancyClick = actions.onVacancyClick;
  const selected = isSelected(actions.selection, "vacancy", vacancy.id);
  const range = { start: groupSpan.startMinute, end: groupSpan.endMinute };
  const geometry = isWeek
    ? {
        top: weekY(range.start) + 1,
        height: weekY(range.end) - weekY(range.start) - 2,
        left: crossOffset,
        width: WEEK_BAR_WIDTH,
      }
    : {
        left: dayX(range.start) + 4,
        width: dayX(range.end) - dayX(range.start) - 8,
        top: crossOffset,
        height: DAY_BAR_HEIGHT,
      };
  const fallbackLabel =
    typeof vacancy.label === "string" ? vacancy.label : vacancy.id;

  return (
    <Tooltip title={vacancy.tooltip}>
      <Box
        data-timeline-part="vacancy"
        data-selected={selected || undefined}
        {...(onVacancyClick === undefined
          ? {}
          : activationProps({
              label: vacancy.ariaLabel ?? fallbackLabel,
              selected: pressedOf(actions, selected),
              date,
              range,
              timezone: actions.timezone,
              onActivate: (point) => {
                onVacancyClick(vacancy, group, point);
              },
            }))}
        sx={(theme) => ({
          position: "absolute",
          ...geometry,
          zIndex: 3,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          ...(isWeek ? { flexDirection: "column", py: 0.5 } : { px: 1 }),
          bgcolor: tone.bgcolor,
          color: tone.text,
          border: 1,
          borderStyle: "dashed",
          borderColor: tone.border,
          borderRadius: 1,
          overflow: "hidden",
          outline: "none",
          ...(onVacancyClick === undefined
            ? { cursor: "default" }
            : stateLayerSx(theme, { tone: vacancy.severity, selected })),
        })}
      >
        <Box
          component="span"
          sx={{
            ...captionStrongSx,
            ...(isWeek ? verticalTextSx : ellipsisSx),
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {vacancy.label}
        </Box>
      </Box>
    </Tooltip>
  );
};
