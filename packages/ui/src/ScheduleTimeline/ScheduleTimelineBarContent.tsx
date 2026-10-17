"use client";

import { Children, type ReactNode } from "react";

import { Box } from "../Box/Box";
import type { ScheduleTimelineBar } from "./schedule-timeline-types";
import { showsSubtitleInBar } from "./timeline-model";
import { captionStrongSx, ellipsisSx, verticalTextSx } from "./timeline-styles";

export interface ScheduleTimelineBarContentProps {
  orientation: "day" | "week";
  bar: ScheduleTimelineBar;
  /** 從前一天接續(標「前日 →」) */
  fromPrevDay: boolean;
  /** 延續到下一天(標「→ 次日」) */
  toNextDay: boolean;
  prevDayLabel: ReactNode;
  nextDayLabel: ReactNode;
}

/**
 * 長條的內容:跨午夜標示、標題、副標、右上角的標記(自動排入、「×2」…)。
 * 日模式一列,標記靠右並排;週模式(窄長條)直排,標記在最上面依序往下排。
 */
export const ScheduleTimelineBarContent = ({
  orientation,
  bar,
  fromPrevDay,
  toNextDay,
  prevDayLabel,
  nextDayLabel,
}: ScheduleTimelineBarContentProps) => {
  const isWeek = orientation === "week";
  // 標記由模組給(陣列),`Children.toArray` 補上 key
  const marks = Children.toArray(bar.marks);
  const textSx = isWeek ? verticalTextSx : ellipsisSx;
  const dayMark = (label: ReactNode) => (
    <Box
      component="span"
      sx={{
        typography: "caption",
        color: "text.secondary",
        flexShrink: 0,
        ...textSx,
        // 直排時箭頭跟著轉向(→ 變成往下),中文字仍直立
        ...(isWeek && { textOrientation: "mixed" }),
      }}
    >
      {label}
    </Box>
  );

  return (
    <>
      {isWeek && marks.length > 0 ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0.25,
            flexShrink: 0,
          }}
        >
          {marks}
        </Box>
      ) : null}
      {fromPrevDay ? dayMark(prevDayLabel) : null}
      <Box
        component="span"
        sx={{
          ...captionStrongSx,
          ...textSx,
          minWidth: 0,
          minHeight: 0,
          flexShrink: 1,
        }}
      >
        {bar.title}
      </Box>
      {showsSubtitleInBar(orientation, bar) && bar.subtitle !== undefined ? (
        <Box
          component="span"
          sx={{
            typography: "caption",
            color:
              bar.state === "disabled" ? "text.disabled" : "text.secondary",
            minWidth: 0,
            ...ellipsisSx,
          }}
        >
          {bar.subtitle}
        </Box>
      ) : null}
      {toNextDay ? dayMark(nextDayLabel) : null}
      {!isWeek && marks.length > 0 ? (
        <Box sx={{ display: "flex", gap: 0.25, ml: "auto", flexShrink: 0 }}>
          {marks}
        </Box>
      ) : null}
    </>
  );
};
