"use client";

import MuiSvgIcon from "@mui/material/SvgIcon";

import type { IconProps } from "./icon-props";

/**
 * 下拉欄位的指示箭頭(實心三角形)。
 * 與 MUI `Select`(`SelectField`)內建的箭頭逐字同一個 path(`@mui/material` 的 `internal/svg-icons/ArrowDropDown`,
 * 那是內部路徑、不能 import),自己畫外框的下拉欄位(樹狀選擇)用它,兩種下拉看起來才一樣。
 * `data-testid` 也照 MUI 內建圖示的慣例(`createSvgIcon` 會掛圖示名)。顏色來自 `SvgIcon` 根節點的 `currentColor`。
 */
export const ArrowDropDownIcon = (props: IconProps) => (
  <MuiSvgIcon data-testid="ArrowDropDownIcon" {...props}>
    <path d="M7 10l5 5 5-5z" />
  </MuiSvgIcon>
);
