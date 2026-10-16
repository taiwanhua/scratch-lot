"use client";

import type { KeyboardEvent } from "react";

import { Box } from "../Box/Box";
import { stateLayerSx } from "../theme/state-layer";
import type { ScheduleTimelineGroup } from "./schedule-timeline-types";
import {
  HEADER_HEIGHT,
  WEEK_DAY_HEIGHT,
  WEEK_MORE_INSET,
  WEEK_MORE_WIDTH,
} from "./timeline-geometry";
import type { TimelineActions } from "./timeline-interaction";
import { captionStrongSx, moreToneColors } from "./timeline-styles";

export interface ScheduleTimelineMoreProps {
  date: string;
  /** 被收起的容器(依完整排序) */
  collapsed: readonly ScheduleTimelineGroup[];
  /** 當天欄寬(px) */
  dayWidth: number;
  actions: TimelineActions;
}

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " ";

/**
 * 「+N」長條(Figma Draft/ScheduleTimelineMore 408:8012):週模式有容器被收起時,當天欄最右邊一條,
 * 高度佔滿 00:00–24:00;框色由模組依被收起內容決定(Neutral / Warning / Error)。點了回呼模組
 * (例:清單浮層)。
 */
export const ScheduleTimelineMore = ({
  date,
  collapsed,
  dayWidth,
  actions,
}: ScheduleTimelineMoreProps) => {
  const tone = moreToneColors(actions.getMoreTone(collapsed, date));
  const { onMoreClick, selection } = actions;
  const selected =
    selection !== null && selection.kind === "more" && selection.date === date;
  const label = actions.formatMoreLabel(collapsed.length);
  const activate = () => {
    onMoreClick?.(date, collapsed);
  };

  return (
    <Box
      data-timeline-part="more"
      data-selected={selected || undefined}
      {...(onMoreClick === undefined
        ? {}
        : {
            role: "button",
            tabIndex: 0,
            "aria-label": `${date} ${label}`,
            "aria-pressed": selected,
            onClick: activate,
            onKeyDown: (event: KeyboardEvent) => {
              if (!isActivationKey(event)) return;
              event.preventDefault();
              activate();
            },
          })}
      sx={(theme) => ({
        position: "absolute",
        top: 1,
        left: dayWidth - WEEK_MORE_INSET,
        width: WEEK_MORE_WIDTH,
        height: WEEK_DAY_HEIGHT - 2,
        zIndex: 2,
        boxSizing: "border-box",
        display: "flex",
        justifyContent: "center",
        pt: 0.75,
        bgcolor: "grey.100",
        border: 1,
        borderColor: tone.border,
        // Figma 6px(theme 圓角 8 × 0.75)
        borderRadius: 0.75,
        outline: "none",
        ...(onMoreClick === undefined
          ? { cursor: "default" }
          : stateLayerSx(theme, { tone: tone.layer, selected })),
      })}
    >
      {/* 捲到下午也看得到「+N」:數字黏在表頭下方 */}
      <Box
        component="span"
        sx={{
          ...captionStrongSx,
          color: tone.text,
          position: "sticky",
          top: HEADER_HEIGHT + 6,
          alignSelf: "flex-start",
        }}
      >
        {label}
      </Box>
    </Box>
  );
};
