"use client";

import MuiTypography, {
  type TypographyProps as MuiTypographyProps,
} from "@mui/material/Typography";

/**
 * 文字顏色只收 MUI Typography 認得的值(STYLE-12)。
 * 帶點的 theme 路徑(`text.secondary`、`warning.main`)MUI 會忽略、畫成一般字色;
 * 要指定色階(例:`warning.dark`)改用 `sx={{ color: "warning.dark" }}`。
 */
export type TypographyColor =
  | "primary"
  | "secondary"
  | "success"
  | "error"
  | "info"
  | "warning"
  | "textPrimary"
  | "textSecondary"
  | "textDisabled";

export type TypographyProps = Omit<MuiTypographyProps, "color"> & {
  color?: TypographyColor;
};

export const Typography = (props: TypographyProps) => (
  <MuiTypography {...props} />
);
