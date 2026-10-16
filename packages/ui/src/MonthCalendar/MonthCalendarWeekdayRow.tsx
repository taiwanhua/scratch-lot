"use client";

import { Box } from "../Box/Box";
import { WEEK_COLUMNS, weekCheckboxColumnWidth } from "./month-calendar-layout";

export interface MonthCalendarWeekdayRowProps {
  /** 從星期日開始的 7 個星期文字 */
  labels: readonly string[];
  /** 多選時左側留出勾選框那一欄 */
  multiple: boolean;
}

/** 星期列(日、一 … 六)。 */
export const MonthCalendarWeekdayRow = ({
  labels,
  multiple,
}: MonthCalendarWeekdayRowProps) => (
  <Box role="row" sx={{ display: "flex" }}>
    {multiple ? (
      <Box
        aria-hidden
        sx={(theme) => ({
          width: weekCheckboxColumnWidth(theme),
          flexShrink: 0,
        })}
      />
    ) : null}
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: WEEK_COLUMNS,
      }}
    >
      {labels.map((label) => (
        <Box
          key={label}
          role="columnheader"
          sx={{
            typography: "caption",
            fontWeight: 600,
            color: "text.secondary",
            textAlign: "center",
            py: 1,
          }}
        >
          {label}
        </Box>
      ))}
    </Box>
  </Box>
);
