"use client";

import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";

import type { IconProps } from "./icon-props";

/**
 * 圓圈勾號(列印按鈕的「已印出」;Figma `Draft/PrintButton` 51:625 的 State=Printed)。取自
 * `@mui/icons-material/CheckCircleOutlined`,做法與理由同 `EditIcon`(單檔路徑 import,顏色跟著父層文字色)。
 */
export const CheckCircleIcon = (props: IconProps) => (
  <CheckCircleOutlined {...props} />
);
