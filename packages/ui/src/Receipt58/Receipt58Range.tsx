"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import {
  type NumberRangeFormat,
  countDistinct,
  formatNumberRanges,
} from "./number-range";
import { receiptTextSx } from "./receipt58-tokens";

export interface Receipt58RangeProps extends NumberRangeFormat {
  /** 區段前的標籤,含標點(例「序號:」)。 */
  label: ReactNode;
  numbers: readonly number[];
  /** 區段後的筆數說明(例 `(n) => \`(${n} 筆)\``);不傳就不印。 */
  formatCount?: (count: number) => ReactNode;
}

/**
 * 號碼區段(Figma `Draft/Receipt58Range`):連號以 `~` 表示、不連號以分隔字隔開,
 * 括號內為筆數;太長自動換行。
 */
export const Receipt58Range = ({
  label,
  numbers,
  formatCount,
  ...format
}: Receipt58RangeProps) => (
  <Box component="p" sx={receiptTextSx("normal")}>
    {label}
    {formatNumberRanges(numbers, format)}
    {formatCount?.(countDistinct(numbers))}
  </Box>
);
