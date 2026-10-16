"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import { receiptTextSx } from "./receipt58-tokens";

export type Receipt58TextVariant = "large" | "normal" | "small" | "bold";
export type Receipt58TextAlign = "left" | "center" | "right";

export interface Receipt58TextProps {
  children: ReactNode;
  /** 大 / 一般 / 小 / 粗體(Figma `Draft/Receipt58Text` 286:77796 的 Style 軸);預設 normal。 */
  variant?: Receipt58TextVariant;
  /** 靠左 / 置中 / 靠右;預設 left。 */
  align?: Receipt58TextAlign;
}

const fontOf = {
  large: { font: "large", isBold: true },
  normal: { font: "normal", isBold: false },
  small: { font: "small", isBold: false },
  bold: { font: "normal", isBold: true },
} as const;

/** 文字列:太長自動換行,不截斷。 */
export const Receipt58Text = ({
  children,
  variant = "normal",
  align = "left",
}: Receipt58TextProps) => (
  <Box
    component="p"
    data-receipt58-text={variant}
    sx={{
      ...receiptTextSx(fontOf[variant].font, fontOf[variant].isBold),
      textAlign: align,
    }}
  >
    {children}
  </Box>
);
