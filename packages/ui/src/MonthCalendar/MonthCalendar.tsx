"use client";

import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

import { Box } from "../Box/Box";
import { todayIn } from "../DatePicker/zoned-day";
import { mergeSx } from "../theme/sx";
import {
  DEFAULT_MAX_CORNERS,
  defaultMoreCornersLabel,
} from "./MonthCalendarCornerMark";
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
import type {
  MonthCalendarCorner,
  MonthCalendarDayInfo,
  MonthCalendarSize,
} from "./month-calendar-types";

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
  /**
   * 換月表頭右側顯示 [今天](只在 `showHeader` 開時出現):點了呼叫 `onMonthChange(今天所在的月份)`,
   * 顯示的已是當月時停用。預設 `false`
   */
  showTodayButton?: boolean;
  /** [今天] 按鈕文字;預設「今天」 */
  todayLabel?: ReactNode;
  /** 選取模式;預設 `none` */
  selectionMode?: MonthCalendarSelectionMode;
  /** 已選的日期(`YYYY-MM-DD`,受控) */
  selectedDates?: readonly string[];
  /** 選取改變時回報新的完整選取(日期排序) */
  onSelectedDatesChange?: (dates: string[]) => void;
  /** 各日期的設定(停用、註記、角標、自訂內容),key 是 `YYYY-MM-DD` */
  days?: Readonly<Partial<Record<string, MonthCalendarDayInfo>>>;
  /**
   * 今天(`YYYY-MM-DD`,畫圓底標示、[今天] 跳到的月份)。沒給時取 `timezone` 此刻的日期;
   * 測試可固定。
   */
  today?: string;
  /**
   * 推算「今天」用的 IANA 時區(admin 傳租戶時區,瀏覽器時區可能和租戶不同);
   * 沒給時用瀏覽器時區,只適合 story / 測試。有傳 `today` 時不用它。
   */
  timezone?: string;
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
  /**
   * 尺寸;預設 `medium`(電腦大格、手機約 48px)。`small` 任何寬度都用約 40px 的小格,
   * 給選日期的浮層、側欄這類窄容器
   */
  size?: MonthCalendarSize;
  /**
   * 一格最多顯示幾個角標(含「+N」);超過時前面的照畫、其餘收成「+N」(同 MUI `AvatarGroup` 的 `max`,
   * 小於 2 時以 2 計)。預設 `medium` 3、`small` 2
   */
  maxCorners?: number;
  /** 「+N」的無障礙名稱;預設列出被收起來的角標文字(都有文字時),否則「還有 N 個標記」 */
  formatMoreCornersLabel?: (hidden: readonly MonthCalendarCorner[]) => string;
  /** 月曆本體的無障礙名稱 */
  "aria-label"?: string;
  sx?: SxProps<Theme>;
}

/**
 * 月曆(Figma Draft/MonthCalendar)。
 * **一週固定從星期日開始**;格子寬度由容器七等分,高度依 `size`(預設電腦大格、手機約 48px)。
 * 月份與選取都是受控值,元件只回報操作,不自己存。
 */
export const MonthCalendar = ({
  month,
  onMonthChange,
  showHeader = true,
  showTodayButton = false,
  todayLabel = "今天",
  selectionMode = "none",
  selectedDates = EMPTY_SELECTION,
  onSelectedDatesChange,
  days,
  today: todayProp,
  timezone,
  weekdayLabels = DEFAULT_WEEKDAY_LABELS,
  formatMonthTitle = defaultMonthTitle,
  prevMonthLabel = "上一個月",
  nextMonthLabel = "下一個月",
  formatDayLabel = (date) => date,
  formatWeekLabel = defaultWeekLabel,
  size = "medium",
  maxCorners = DEFAULT_MAX_CORNERS[size],
  formatMoreCornersLabel = defaultMoreCornersLabel,
  "aria-label": ariaLabel,
  sx,
}: MonthCalendarProps) => {
  const today = todayProp ?? todayIn(timezone);
  // `today` 是 `YYYY-MM-DD`,前 7 碼就是今天所在的月份 `YYYY-MM`
  const todayMonth = today.slice(0, 7);
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
          todayButton={
            showTodayButton
              ? {
                  label: todayLabel,
                  disabled: todayMonth === month,
                  onClick: () => onMonthChange?.(todayMonth),
                }
              : undefined
          }
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
                size={size}
                maxCorners={maxCorners}
                formatMoreCornersLabel={formatMoreCornersLabel}
              />
            ))}
          </MonthCalendarWeekRow>
        ))}
      </Box>
    </Box>
  );
};
