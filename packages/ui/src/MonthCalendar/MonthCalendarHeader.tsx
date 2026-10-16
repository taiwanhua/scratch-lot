"use client";

import type { ReactNode } from "react";

import { Box } from "../Box/Box";
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
}

/** 換月表頭「◀ 2026 年 11 月 ▶」(Figma Draft/MonthCalendar 48:360 的上緣)。 */
export const MonthCalendarHeader = ({
  title,
  prevMonthLabel,
  nextMonthLabel,
  onPrev,
  onNext,
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
  </Box>
);
