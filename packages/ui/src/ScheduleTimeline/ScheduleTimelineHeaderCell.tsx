"use client";

import MuiTableCell from "@mui/material/TableCell";
import type { ReactNode } from "react";

import { Box } from "../Box/Box";
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
 * 時間軸的表頭一格:用表格的表頭格(Figma Draft/TableHeaderCell,主題的 `MuiTableCell` head 樣式)。
 * 今天的日期畫成主色實心圓、字色 `primary.contrastText`,和 `MonthCalendar` 的今天同一個樣式。
 */
export const ScheduleTimelineHeaderCell = ({
  width,
  date,
  isToday = false,
  label,
}: ScheduleTimelineHeaderCellProps) => (
  <MuiTableCell
    component="div"
    variant="head"
    role="columnheader"
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
        sx={(theme) => ({
          minWidth: theme.spacing(3),
          height: theme.spacing(3),
          px: isToday ? 0.75 : 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: theme.spacing(1.5),
          ...(isToday && {
            bgcolor: "primary.main",
            color: "primary.contrastText",
            fontWeight: 600,
          }),
        })}
      >
        {shortDate(date)}
      </Box>
    )}
    {label}
  </MuiTableCell>
);
