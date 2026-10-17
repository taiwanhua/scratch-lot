"use client";

import type { ReactNode } from "react";

import { Box } from "../Box/Box";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { Typography } from "../Typography/Typography";
import { ChevronLeftIcon } from "../icons/ChevronLeftIcon";
import { ChevronRightIcon } from "../icons/ChevronRightIcon";

export interface MonthCalendarHeaderProps {
  title: ReactNode;
  prevMonthLabel: string;
  nextMonthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  /** [今天] 按鈕(選用);沒給就不顯示 */
  todayButton?: {
    label: ReactNode;
    /** 顯示的已是今天所在的月份 */
    disabled: boolean;
    onClick: () => void;
  };
}

/** 換月表頭「◀ 2026 年 11 月 ▶」與右側選用的 [今天](Figma Draft/MonthCalendar 48:360 的上緣)。 */
export const MonthCalendarHeader = ({
  title,
  prevMonthLabel,
  nextMonthLabel,
  onPrev,
  onNext,
  todayButton,
}: MonthCalendarHeaderProps) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
    <IconButton
      variant="outlined"
      size="small"
      aria-label={prevMonthLabel}
      onClick={onPrev}
    >
      <ChevronLeftIcon fontSize="small" />
    </IconButton>
    <Typography variant="h6" component="h2" aria-live="polite">
      {title}
    </Typography>
    <IconButton
      variant="outlined"
      size="small"
      aria-label={nextMonthLabel}
      onClick={onNext}
    >
      <ChevronRightIcon fontSize="small" />
    </IconButton>
    {todayButton === undefined ? null : (
      <Button
        // 和 ◀ ▶(IconButton outlined)同一種外觀:灰框(divider)、一般文字色,不用主色
        variant="outlined"
        color="inherit"
        size="small"
        disabled={todayButton.disabled}
        onClick={todayButton.onClick}
        sx={{ ml: "auto", borderColor: "divider", color: "text.primary" }}
      >
        {todayButton.label}
      </Button>
    )}
  </Box>
);
