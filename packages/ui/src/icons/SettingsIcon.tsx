"use client";

import SettingsOutlined from "@mui/icons-material/SettingsOutlined";

import type { IconProps } from "./icon-props";

/**
 * 設定(表單設計器分區標題旁的「分區設定」)。取自 `@mui/icons-material/SettingsOutlined`,
 * 做法與理由同 `EditIcon`(單檔路徑 import,顏色跟著父層文字色)。
 */
export const SettingsIcon = (props: IconProps) => (
  <SettingsOutlined {...props} />
);
