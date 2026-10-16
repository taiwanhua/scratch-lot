"use client";

import type { SxProps, Theme } from "@mui/material/styles";
import dayjs from "dayjs";
import type { ReactNode } from "react";

import { Box } from "../Box/Box";
import { mergeSx } from "../theme/sx";
import { MonthCalendarDayCell } from "./MonthCalendarDayCell";
import { MonthCalendarHeader } from "./MonthCalendarHeader";
import { MonthCalendarWeekRow } from "./MonthCalendarWeekRow";
import { MonthCalendarWeekdayRow } from "./MonthCalendarWeekdayRow";
import {
  buildMonthWeeks,
  monthParts,
  shiftMonth,
  toggleDaySelection,
} from "./month-calendar-grid";
import type { MonthCalendarDayInfo } from "./month-calendar-types";

export type * from "./month-calendar-types";

/** 選取模式:不選 / 單選 / 多選(整週勾選框只在 `multiple` 出現)。 */
export type MonthCalendarSelectionMode = "none" | "single" | "multiple";

/** 預設星期列(一週從星期日開始);ui 不做 i18n,呼叫端以 `weekdayLabels` 覆寫。 */
const DEFAULT_WEEKDAY_LABELS = [
  "日",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
] as const;

const defaultMonthTitle = (month: string) => {
  const { year, month: m } = monthParts(month);
  return `${String(year)} 年 ${String(m)} 月`;
};

const defaultWeekLabel = (weekIndex: number) =>
  `選取第 ${String(weekIndex + 1)} 週`;

const EMPTY_SELECTION: readonly string[] = [];

export interface MonthCalendarProps {
  /** 顯示的月份 `YYYY-MM`;由使用的頁面控制,元件不自己記月份 */
  month: string;
  /** 按表頭 ◀ / ▶ 時回報上 / 下個月(`YYYY-MM`) */
  onMonthChange?: (month: string) => void;
  /** 顯示內建換月表頭;關掉時換月由使用的頁面自己提供。預設 `true` */
  showHeader?: boolean;
  /** 選取模式;預設 `none` */
  selectionMode?: MonthCalendarSelectionMode;
  /** 已選的日期(`YYYY-MM-DD`,受控) */
  selectedDates?: readonly string[];
  /** 選取改變時回報新的完整選取(日期排序) */
  onSelectedDatesChange?: (dates: string[]) => void;
  /** 各日期的設定(停用、註記、角標、自訂內容),key 是 `YYYY-MM-DD` */
  days?: Readonly<Partial<Record<string, MonthCalendarDayInfo>>>;
  /**
   * 今天(`YYYY-MM-DD`,畫圓底標示)。使用處要傳**租戶時區**的今天(瀏覽器時區可能和租戶不同);
   * 沒給時退回瀏覽器當地日期,只適合 story / 測試
   */
  today?: string;
  /** 星期列文字,從星期日開始的 7 個 */
  weekdayLabels?: readonly string[];
  /** 表頭標題;預設「2026 年 11 月」 */
  formatMonthTitle?: (month: string) => ReactNode;
  /** 表頭按鈕的無障礙名稱 */
  prevMonthLabel?: string;
  nextMonthLabel?: string;
  /** 日期格的無障礙名稱;預設 `YYYY-MM-DD` */
  formatDayLabel?: (date: string) => string;
  /** 整週勾選框的無障礙名稱(`weekIndex` 從 0 起) */
  formatWeekLabel?: (weekIndex: number) => string;
  /** 月曆本體的無障礙名稱 */
  "aria-label"?: string;
  sx?: SxProps<Theme>;
}

/**
 * 月曆(《底座規格》10.5;Figma Draft/MonthCalendar 48:360、BS-23 260:6356)。
 * **一週固定從星期日開始**;格子寬度由容器七等分,高度電腦大格、手機約 48px。
 * 月份與選取都是受控值,元件只回報操作,不自己存。
 */
export const MonthCalendar = ({
  month,
  onMonthChange,
  showHeader = true,
  selectionMode = "none",
  selectedDates = EMPTY_SELECTION,
  onSelectedDatesChange,
  days,
  today = dayjs().format("YYYY-MM-DD"),
  weekdayLabels = DEFAULT_WEEKDAY_LABELS,
  formatMonthTitle = defaultMonthTitle,
  prevMonthLabel = "上一個月",
  nextMonthLabel = "下一個月",
  formatDayLabel = (date) => date,
  formatWeekLabel = defaultWeekLabel,
  "aria-label": ariaLabel,
  sx,
}: MonthCalendarProps) => {
  const weeks = buildMonthWeeks(month);
  const selected = new Set(selectedDates);
  const multiple = selectionMode === "multiple";
  const isDisabled = (date: string) => days?.[date]?.disabled === true;

  const selectDay = (date: string) => {
    if (selectionMode === "single") onSelectedDatesChange?.([date]);
    if (multiple)
      onSelectedDatesChange?.(toggleDaySelection(selectedDates, date));
  };

  return (
    <Box sx={mergeSx({ minWidth: 0 }, sx)}>
      {showHeader ? (
        <MonthCalendarHeader
          title={formatMonthTitle(month)}
          prevMonthLabel={prevMonthLabel}
          nextMonthLabel={nextMonthLabel}
          onPrev={() => onMonthChange?.(shiftMonth(month, -1))}
          onNext={() => onMonthChange?.(shiftMonth(month, 1))}
        />
      ) : null}
      <Box
        role="grid"
        aria-label={ariaLabel}
        aria-multiselectable={multiple || undefined}
      >
        <MonthCalendarWeekdayRow labels={weekdayLabels} multiple={multiple} />
        {weeks.map((week, weekIndex) => (
          <MonthCalendarWeekRow
            key={week[0]?.date}
            week={week}
            multiple={multiple}
            weekLabel={formatWeekLabel(weekIndex)}
            selectedDates={selectedDates}
            isDisabled={isDisabled}
            onSelectedDatesChange={onSelectedDatesChange}
            first={weekIndex === 0}
          >
            {week.map((day) => (
              <MonthCalendarDayCell
                key={day.date}
                day={day}
                info={days?.[day.date]}
                selectable={
                  selectionMode !== "none" &&
                  day.inMonth &&
                  !isDisabled(day.date)
                }
                selectionEnabled={selectionMode !== "none"}
                selected={day.inMonth && selected.has(day.date)}
                isToday={day.date === today}
                label={formatDayLabel(day.date)}
                onSelect={selectDay}
              />
            ))}
          </MonthCalendarWeekRow>
        ))}
      </Box>
    </Box>
  );
};
