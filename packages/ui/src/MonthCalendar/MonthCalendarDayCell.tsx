"use client";

import { type Theme, alpha } from "@mui/material/styles";
import type { KeyboardEvent, ReactNode } from "react";

import { Box } from "../Box/Box";
import { Tooltip } from "../Tooltip/Tooltip";
import { stateLayerSx } from "../theme/state-layer";
import { todayMarkSx } from "../theme/today-mark";
import { MonthCalendarCornerMarks } from "./MonthCalendarCornerMark";
import type { CalendarDay } from "./month-calendar-grid";
import type {
  MonthCalendarCorner,
  MonthCalendarDayInfo,
  MonthCalendarDayTone,
  MonthCalendarSize,
} from "./month-calendar-types";

/** 底色語意 → 主題 token(色碼由主題決定,深色模式跟著換)。 */
const TONE_BACKGROUND: Record<MonthCalendarDayTone, string> = {
  special: "info.lighter",
  closed: "action.hover",
};

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
  size: MonthCalendarSize;
  /** 角標最多顯示幾個(含「+N」) */
  maxCorners: number;
  /** 「+N」的無障礙名稱 */
  formatMoreCornersLabel: (hidden: readonly MonthCalendarCorner[]) => string;
}

/**
 * 格子底色:停用色 > 資料帶來的顏色(以主題的 `selectedOpacity` 淡化,文字對比照舊)> 語意底色 > 紙色。
 */
const backgroundOf = (
  theme: Theme,
  {
    disabled,
    tone,
    source,
  }: {
    disabled: boolean;
    tone: MonthCalendarDayTone | undefined;
    source: string | undefined;
  },
): string => {
  if (disabled) {
    return "action.disabledBackground";
  }
  if (source !== undefined) {
    // 資料帶來的是一般色碼(例 `#006064`):用獨立的 `alpha`(`theme.alpha` 在 CSS 變數主題下只收色彩通道)
    return alpha(source, theme.palette.action.selectedOpacity);
  }
  return tone === undefined ? "background.paper" : TONE_BACKGROUND[tone];
};

/** 這一天的角標:`corners` 優先;只給舊的單一 `corner` 時當成一個。 */
const cornersOf = (
  info: MonthCalendarDayInfo,
): readonly MonthCalendarCorner[] => {
  if (info.corners !== undefined) {
    return info.corners;
  }
  return info.corner === undefined ? [] : [info.corner];
};

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " ";

/**
 * 日期數字與註記疊在 `content` 的鋪滿裝飾(`position: absolute` 的底紋等)之上;
 * 格子自成一層(`isolation: isolate`),這個層級不會蓋到格子外的浮層。
 */
const aboveContentSx = { position: "relative", zIndex: 1 } as const;

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
  size,
  maxCorners,
  formatMoreCornersLabel,
}: MonthCalendarDayCellProps) => {
  const disabled = day.inMonth && info?.disabled === true;
  const muted = !day.inMonth || disabled;
  const tone = day.inMonth ? info?.tone : undefined;
  const source = day.inMonth ? info?.background : undefined;
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
      data-tone={tone}
      data-background={source}
      data-size={size}
      tabIndex={selectable ? 0 : undefined}
      onClick={select}
      onKeyDown={(event: KeyboardEvent) => {
        if (!isActivationKey(event)) return;
        event.preventDefault();
        select();
      }}
      sx={(theme) => ({
        position: "relative",
        isolation: "isolate",
        minWidth: 0,
        // medium:電腦大格、手機約 48px;small:一律約 40px。寬度由容器七等分
        minHeight:
          size === "small"
            ? theme.spacing(5)
            : { xs: theme.spacing(6), md: theme.spacing(12) },
        p: size === "small" ? 0.5 : { xs: 0.5, md: 1 },
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        bgcolor: backgroundOf(theme, { disabled, tone, source }),
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
        data-day-number
        sx={(theme) => ({
          ...aboveContentSx,
          typography: "body2",
          ...todayMarkSx(theme, { isToday, shape: "circle" }),
        })}
      >
        {day.day}
      </Box>
      {day.inMonth && info !== undefined ? (
        <MonthCalendarCornerMarks
          corners={cornersOf(info)}
          size={size}
          max={maxCorners}
          formatMoreLabel={formatMoreCornersLabel}
        />
      ) : null}
      {day.inMonth && info?.note ? (
        <Box
          component="span"
          data-day-note
          sx={{
            ...aboveContentSx,
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
