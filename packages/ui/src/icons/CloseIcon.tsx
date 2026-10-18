"use client";

import MuiSvgIcon from "@mui/material/SvgIcon";

import type { IconProps } from "./icon-props";

/** 關閉(Draft/RouteTab 26:42 的 close,12×12;路由頁籤的關閉鈕)。 */
export const CloseIcon = (props: IconProps) => (
  <MuiSvgIcon viewBox="0 0 12 12" fill="none" {...props}>
    <path
      d="M3 3L9 9M9 3L3 9"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
    />
  </MuiSvgIcon>
);
