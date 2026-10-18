"use client";

import MuiIconButton, {
  type IconButtonProps as MuiIconButtonProps,
} from "@mui/material/IconButton";
import { styled } from "@mui/material/styles";

/** 外框變體的邊長(px):跟著 `size` 走,與 Figma collapse-toggle 246:97 的 40×40 對齊。 */
const OUTLINED_SIZE: Record<string, number> = {
  small: 32,
  medium: 40,
  large: 48,
};

export interface IconButtonProps extends MuiIconButtonProps {
  /**
   * 外觀。`plain`(預設)= MUI 原本的純圖示按鈕;
   * `outlined` = 加一圈 `divider` 外框、固定正方形(側欄收合開關、工具列的方形圖示鈕)。
   *
   * 幾何寫在元件內(STYLE-07),呼叫端不要再用 `sx` 重設 —— 這個變體就是為了讓
   * `AdminShell/SideNavToggle` 那處 STYLE-10 例外退場。
   */
  variant?: "plain" | "outlined";
}

/**
 * `variant="outlined"` 的外框與正方形幾何。用 `styled()` 而不是 `sx`,呼叫端傳 `sx`
 * 才只會疊加、蓋不掉(STYLE-07);`variant` 在下方就被解構掉,不會漏到 DOM。
 */
const OutlinedIconButton = styled(MuiIconButton)(({ theme, size }) => {
  const edge = OUTLINED_SIZE[size ?? "medium"] ?? OUTLINED_SIZE.medium;
  return {
    width: edge,
    height: edge,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    color: theme.palette.text.secondary,
  };
});

/** 只有圖示的按鈕(路由頁籤的關閉鈕、AppBar 的「?」說明鈕、列表的列操作)。用者必給 `aria-label`。 */
export const IconButton = ({ variant = "plain", ...rest }: IconButtonProps) =>
  variant === "outlined" ? (
    <OutlinedIconButton {...rest} />
  ) : (
    <MuiIconButton {...rest} />
  );
