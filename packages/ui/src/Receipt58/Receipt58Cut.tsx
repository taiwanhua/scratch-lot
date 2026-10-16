"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import {
  RECEIPT58_INK,
  RECEIPT58_STROKE,
  dots,
  receiptTextSx,
} from "./receipt58-tokens";

export interface Receipt58CutProps {
  /** 切紙位置的說明文字(例「切紙」);語言由使用處決定。 */
  label: ReactNode;
}

/**
 * 切紙位置(Figma `Draft/Receipt58Cut` 286:77820):印完由收據機自動切紙,
 * 這一列標出切刀的位置,讓測試頁確認切刀。
 */
export const Receipt58Cut = ({ label }: Receipt58CutProps) => (
  <Box
    data-receipt58-cut=""
    sx={{ display: "flex", alignItems: "center", gap: dots(6) }}
  >
    <Box component="span" aria-hidden sx={receiptTextSx("small")}>
      ✂
    </Box>
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        borderTop: `${dots(RECEIPT58_STROKE)} dotted`,
        borderColor: RECEIPT58_INK,
      }}
    />
    <Box component="span" sx={receiptTextSx("small")}>
      {label}
    </Box>
  </Box>
);
