"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import { RECEIPT58_LABEL_SX, dots, receiptTextSx } from "./receipt58-tokens";

export interface Receipt58RowProps {
  label: ReactNode;
  value: ReactNode;
}

/**
 * 「標籤:值」列(Figma `Draft/Receipt58Row`):標籤靠左、值靠右;
 * 標籤、值太長時各自在自己的欄內換行,不截斷(標籤最多佔一半寬)。
 */
export const Receipt58Row = ({ label, value }: Receipt58RowProps) => (
  <Box sx={{ display: "flex", alignItems: "flex-start", gap: dots(8) }}>
    <Box
      component="span"
      sx={{ ...receiptTextSx("normal"), ...RECEIPT58_LABEL_SX }}
    >
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
