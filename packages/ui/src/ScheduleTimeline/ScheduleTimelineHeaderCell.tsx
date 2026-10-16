"use client";

import type { ReactNode } from "react";

import { Box } from "../Box/Box";
import { todayMarkSx } from "../theme/today-mark";
import { HEADER_HEIGHT } from "./timeline-geometry";

export interface ScheduleTimelineHeaderCellProps {
  width: number;
  /** 日期表頭:`YYYY-MM-DD`(顯示成 M/D);時間表頭(日模式的小時)不給 */
  date?: string;
  /** 今天:日期畫成主色實心圓 */
  isToday?: boolean;
  /** 日期後面的文字(例:「三 店慶」)/ 時間表頭的文字 */
  label?: ReactNode;
}

/** `YYYY-MM-DD` →「M/D」 */
const shortDate = (date: string) =>
  [date.slice(5, 7), date.slice(8, 10)]
    .map((part) => String(Number(part)))
    .join("/");

/**
 * 時間軸的表頭一格,外觀照表格的表頭格(Figma Draft/TableHeaderCell:`background.default` 底、
 * `text.secondary` 字、Subtitle/2 粗體,與主題 `MuiTableCell` head 同一組 token)。
 * 不用 `MuiTableCell` 本身:時間軸不是表格,TableCell 的 head 變體會在 div 上補 `scope`(只對 th 合法);
 * 也不標 `columnheader`(沒有 grid / table 的外層就不合法),是一般的文字。
 * 今天的日期用 `todayMarkSx`(和 `MonthCalendar` 共用),表頭的「M/D」較寬,畫成膠囊。
 */
export const ScheduleTimelineHeaderCell = ({
  width,
  date,
  isToday = false,
  label,
}: ScheduleTimelineHeaderCellProps) => (
  <Box
    data-timeline-header=""
    aria-current={isToday ? "date" : undefined}
    sx={{
      boxSizing: "border-box",
      width,
      flexShrink: 0,
      height: HEADER_HEIGHT,
      px: 1,
      py: 0,
      display: "flex",
      alignItems: "center",
      gap: 0.5,
      typography: "subtitle2",
      fontWeight: 600,
      color: "text.secondary",
      bgcolor: "background.default",
      whiteSpace: "nowrap",
      overflow: "hidden",
      borderBottom: 1,
      borderColor: "divider",
    }}
  >
    {date === undefined ? null : (
      <Box
        component="span"
        data-today={isToday || undefined}
        sx={(theme) => todayMarkSx(theme, { isToday, shape: "pill" })}
      >
        {shortDate(date)}
      </Box>
    )}
    {label}
  </Box>
);
