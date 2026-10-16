"use client";

import type { ReactNode } from "react";

import { Box } from "../Box/Box";
import { Checkbox } from "../Checkbox/Checkbox";
import {
  type CalendarDay,
  selectableDatesOf,
  toggleWeekSelection,
  weekSelectionState,
} from "./month-calendar-grid";
import { WEEK_COLUMNS, weekCheckboxColumnWidth } from "./month-calendar-layout";

export interface MonthCalendarWeekRowProps {
  week: readonly CalendarDay[];
  /** 多選:左側出現整週勾選框 */
  multiple: boolean;
  /** 整週勾選框的無障礙名稱 */
  weekLabel: string;
  selectedDates: readonly string[];
  isDisabled: (date: string) => boolean;
  onSelectedDatesChange: ((dates: string[]) => void) | undefined;
  /** 第一週補上方框線 */
  first: boolean;
  /** 七個日期格 */
  children: ReactNode;
}

/**
 * 月曆的一週。多選時左側的整週勾選框:該週可選的日子沒全選 → 全選(跳過停用日)、
 * 都已選 → 全部取消;部分選顯示半選;整週沒有可選的日子時停用。
 */
export const MonthCalendarWeekRow = ({
  week,
  multiple,
  weekLabel,
  selectedDates,
  isDisabled,
  onSelectedDatesChange,
  first,
  children,
}: MonthCalendarWeekRowProps) => {
  const selectable = selectableDatesOf(week, isDisabled);
  const state = weekSelectionState(selectable, new Set(selectedDates));
  return (
    <Box role="row" sx={{ display: "flex" }}>
      {multiple ? (
        <Box
          role="gridcell"
          sx={(theme) => ({
            width: weekCheckboxColumnWidth(theme),
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
          })}
        >
          <Checkbox
            size="small"
            checked={state === "all"}
            indeterminate={state === "some"}
            disabled={state === "disabled"}
            onChange={() =>
              onSelectedDatesChange?.(
                toggleWeekSelection(selectedDates, selectable),
              )
            }
            slotProps={{ input: { "aria-label": weekLabel } }}
          />
        </Box>
      ) : null}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: WEEK_COLUMNS,
          borderLeft: 1,
          borderTop: first ? 1 : 0,
          borderColor: "divider",
        }}
      >
        {children}
      </Box>
    </Box>
  );
};
