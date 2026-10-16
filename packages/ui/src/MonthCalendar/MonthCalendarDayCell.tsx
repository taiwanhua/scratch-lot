"use client";

import type { Theme } from "@mui/material/styles";
import type { KeyboardEvent, ReactNode } from "react";

import { Box } from "../Box/Box";
import { Tooltip } from "../Tooltip/Tooltip";
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

/** 有 CSS 變數時取 `theme.vars`,深色模式跟著換色(同 `DataTable/pinned-cell-sx.ts`)。 */
const paletteOf = (theme: Theme) => (theme.vars ?? theme).palette;

/** 1px 內框(inset 陰影,不佔版面)。 */
const ring = (color: string) => `inset 0 0 0 1px ${color}`;

/** 一層 state layer:同一色值的漸層當成疊在底色上的半透明圖層。 */
const layer = (color: string) => `linear-gradient(${color}, ${color})`;

/**
 * 互動狀態(《底座規格》10.11):日期格是白底(bg/paper),state layer 用 `grey/500` 疊,
 * 即主題的 `action.hover`(8%)/ `action.selected`(16%);滑過邊框換 `grey/500`,
 * 已選取加 1px `primary.main` 邊框(Figma Draft/MonthCalendar 48:360 的已選格)。
 * 邊框用 inset 陰影畫,不佔版面,選取時格子不會位移。
 */
const interactiveSx = (theme: Theme, selected: boolean) => {
  const palette = paletteOf(theme);
  const selectedLayer = selected ? [layer(palette.action.selected)] : [];
  return {
    cursor: "pointer",
    backgroundImage: selectedLayer.join(", ") || "none",
    boxShadow: selected ? ring(palette.primary.main) : "none",
    "@media (hover: hover)": {
      "&:hover": {
        backgroundImage: [layer(palette.action.hover), ...selectedLayer].join(
          ", ",
        ),
        boxShadow: ring(selected ? palette.primary.main : palette.grey[500]),
      },
    },
    // 觸控裝置沒有滑過:按下時底色加深
    "&:active": {
      backgroundImage: [layer(palette.action.selected), ...selectedLayer].join(
        ", ",
      ),
    },
    "&:focus-visible": {
      outline: `2px solid ${palette.action.focus}`,
      outlineOffset: "-2px",
    },
  };
};

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " ";

/** 月曆的一格(Figma Draft/MonthCalendarCell 48:359):日期數字、角標、註記、自訂內容。 */
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
        // 電腦大格、手機約 48px(《底座規格》10.5);寬度由容器七等分
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
        ...(selectable
          ? interactiveSx(theme, selected)
          : { cursor: "default" }),
      })}
    >
      <Box
        component="span"
        sx={(theme) => ({
          typography: "body2",
          width: theme.spacing(3),
          height: theme.spacing(3),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          ...(isToday && {
            bgcolor: "primary.main",
            color: "primary.contrastText",
            fontWeight: 600,
          }),
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
