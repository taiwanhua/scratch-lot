"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import { dots, receiptTextSx } from "./receipt58-tokens";

export interface Receipt58RowProps {
  label: ReactNode;
  value: ReactNode;
}

/**
 * 「標籤:值」列(Figma `Draft/Receipt58Row` 51:626):標籤靠左、值靠右;
 * 值太長時在右側自動換行,不截斷。
 */
export const Receipt58Row = ({ label, value }: Receipt58RowProps) => (
  <Box sx={{ display: "flex", alignItems: "flex-start", gap: dots(8) }}>
    <Box component="span" sx={{ ...receiptTextSx("normal"), flexShrink: 0 }}>
      {label}
    </Box>
    <Box
      component="span"
      sx={{
        ...receiptTextSx("normal"),
        flex: 1,
        minWidth: 0,
        textAlign: "right",
      }}
    >
      {value}
    </Box>
  </Box>
);
