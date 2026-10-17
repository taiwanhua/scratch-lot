"use client";

import MuiSvgIcon from "@mui/material/SvgIcon";

import type { IconProps } from "./icon-props";

/** 上一個(MonthCalendar 換月表頭的 ◀;`ChevronRightIcon` 的鏡像)。 */
export const ChevronLeftIcon = (props: IconProps) => (
  <MuiSvgIcon viewBox="0 0 16 16" fill="none" {...props}>
    <path
      d="M10 4L6 8L10 12"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </MuiSvgIcon>
);
