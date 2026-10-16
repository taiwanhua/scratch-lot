"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import { dots, receiptTextSx } from "./receipt58-tokens";

export interface Receipt58TotalProps {
  label: ReactNode;
  value: ReactNode;
}

/** 合計列(Figma `Draft/Receipt58Total` 80:1511):標籤與金額都用粗體大一級的字。 */
export const Receipt58Total = ({ label, value }: Receipt58TotalProps) => (
  <Box sx={{ display: "flex", alignItems: "flex-start", gap: dots(8) }}>
    <Box
      component="span"
      sx={{ ...receiptTextSx("title", true), flexShrink: 0 }}
    >
      {label}
    </Box>
    <Box
      component="span"
      sx={{
        ...receiptTextSx("title", true),
        flex: 1,
        minWidth: 0,
        textAlign: "right",
      }}
    >
      {value}
    </Box>
  </Box>
);
