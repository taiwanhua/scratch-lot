"use client";

import MenuOutlined from "@mui/icons-material/MenuOutlined";

import type { IconProps } from "./icon-props";

/**
 * 主選單(手機寬 AppBar 左側開啟側欄抽屜的按鈕)。取自 `@mui/icons-material/MenuOutlined`,
 * 做法與理由同 `EditIcon`(單檔路徑 import,顏色跟著父層文字色)。
 */
export const MenuIcon = (props: IconProps) => <MenuOutlined {...props} />;
