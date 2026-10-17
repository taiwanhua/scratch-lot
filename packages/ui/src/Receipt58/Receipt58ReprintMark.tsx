"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import {
  RECEIPT58_INK,
  RECEIPT58_STROKE,
  dots,
  receiptTextSx,
} from "./receipt58-tokens";

export interface Receipt58ReprintMarkProps {
  /** 例「【補印】第 2 次」(含第幾次;文字由使用處依語系組好)。 */
  heading: ReactNode;
  /** 補印時間:使用處依租戶時區以 `formatTemporal` 格式化後傳入。 */
  time: ReactNode;
  /** 例「原因:破損」;原因為「其他」時由使用處改傳說明文字。 */
  reason: ReactNode;
  /** 例「補印人:李大華」。 */
  reprintedBy: ReactNode;
}

/** 四段之間的分隔(規格:「【補印】第 N 次 · 時間 · 原因 · 補印人」)。 */
const SEPARATOR = " · ";

/**
 * 補印標示(規格第 6 章「版面零件」):外框粗體一行,依序印第幾次、時間、原因、補印人,太長自動換行。
 * 只在補印的單據上出現;第一次列印不印。
 */
export const Receipt58ReprintMark = ({
  heading,
  time,
  reason,
  reprintedBy,
}: Receipt58ReprintMarkProps) => (
  <Box
    component="p"
    data-receipt58-reprint=""
    sx={{
      ...receiptTextSx("small", true),
      alignSelf: "stretch",
      textAlign: "center",
      px: dots(8),
      py: dots(2),
      border: `${dots(RECEIPT58_STROKE)} solid`,
      borderColor: RECEIPT58_INK,
    }}
  >
    {heading}
    {SEPARATOR}
    {time}
    {SEPARATOR}
    {reason}
    {SEPARATOR}
    {reprintedBy}
  </Box>
);
