"use client";

import ErrorOutlineOutlined from "@mui/icons-material/ErrorOutlineOutlined";

import type { IconProps } from "./icon-props";

/**
 * 圓圈驚嘆號(列印按鈕的「失敗」;Figma `Draft/PrintButton` 51:625 的 State=Failed)。取自
 * `@mui/icons-material/ErrorOutlineOutlined`,做法與理由同 `EditIcon`(單檔路徑 import,顏色跟著父層文字色)。
 */
export const ErrorCircleIcon = (props: IconProps) => (
  <ErrorOutlineOutlined {...props} />
);
