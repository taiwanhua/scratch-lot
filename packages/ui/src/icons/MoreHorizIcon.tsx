"use client";

import MoreHorizOutlined from "@mui/icons-material/MoreHorizOutlined";

import type { IconProps } from "./icon-props";

/**
 * 更多操作「⋯」(路由頁籤列最右的頁籤選單鈕)。取自 `@mui/icons-material/MoreHorizOutlined`,
 * 做法與理由同 `EditIcon`(單檔路徑 import,顏色跟著父層文字色)。
 */
export const MoreHorizIcon = (props: IconProps) => (
  <MoreHorizOutlined {...props} />
);
