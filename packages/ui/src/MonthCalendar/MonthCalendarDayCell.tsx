"use client";

import type { KeyboardEvent, ReactNode } from "react";

import { Box } from "../Box/Box";
import { Tooltip } from "../Tooltip/Tooltip";
import { stateLayerSx } from "../theme/state-layer";
import { todayMarkSx } from "../theme/today-mark";
import { MonthCalendarCornerMark } from "./MonthCalendarCornerMark";
import type { CalendarDay } from "./month-calendar-grid";
import type { MonthCalendarDayInfo } from "./month-calendar-types";

export interface MonthCalendarDayCellProps {
  day: CalendarDay;
  info: MonthCalendarDayInfo | undefined;
  /** 有選取模式、本月、沒停用 → 可點 */
  selectable: boolean;
  /** 有選取模式時才回報 `aria-selected` */
  selectionEnabled: boolean;
  selected: boolean;
  isToday: boolean;
  /** 格子的無障礙名稱 */
  label: string;
  onSelect: (date: string) => void;
}

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " ";

/** 月曆的一格(Figma Draft/MonthCalendarCell):日期數字、角標、註記、自訂內容。 */
export const MonthCalendarDayCell = ({
  day,
  info,
  selectable,
  selectionEnabled,
  selected,
  isToday,
  label,
  onSelect,
}: MonthCalendarDayCellProps) => {
  const disabled = day.inMonth && info?.disabled === true;
  const muted = !day.inMonth || disabled;
  const select = () => {
    if (selectable) onSelect(day.date);
  };
  const cell: ReactNode = (
    <Box
      role="gridcell"
      aria-label={label}
      aria-selected={selectionEnabled ? selected : undefined}
      aria-disabled={muted || undefined}
      data-date={day.date}
      tabIndex={selectable ? 0 : undefined}
      onClick={select}
      onKeyDown={(event: KeyboardEvent) => {
        if (!isActivationKey(event)) return;
        event.preventDefault();
        select();
      }}
      sx={(theme) => ({
        position: "relative",
        minWidth: 0,
        // 電腦大格、手機約 48px;寬度由容器七等分
        minHeight: { xs: theme.spacing(6), md: theme.spacing(12) },
        p: { xs: 0.5, md: 1 },
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        bgcolor: disabled ? "action.disabledBackground" : "background.paper",
        color: muted ? "text.disabled" : "text.primary",
        borderRight: 1,
        borderBottom: 1,
        borderColor: "divider",
        outline: "none",
        // 互動狀態:白底格,滑過疊灰(`action.hover`);
        // 已選取疊 `primary.main` × `selectedOpacity` + 1px `primary.main` 框
        ...(selectable
          ? stateLayerSx(theme, { selected, selectedTone: "primary" })
          : { cursor: "default" }),
      })}
    >
      <Box
        component="span"
        sx={(theme) => ({
          typography: "body2",
          ...todayMarkSx(theme, { isToday, shape: "circle" }),
        })}
      >
        {day.day}
      </Box>
      {day.inMonth && info?.corner ? (
        <MonthCalendarCornerMark corner={info.corner} />
      ) : null}
      {day.inMonth && info?.note ? (
        <Box
          component="span"
          sx={{
            typography: "caption",
            color: "text.secondary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {info.note}
        </Box>
      ) : null}
      {day.inMonth ? info?.content : null}
    </Box>
  );
  return disabled && info.disabledReason ? (
    <Tooltip title={info.disabledReason}>{cell}</Tooltip>
  ) : (
    cell
  );
};
