"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import {
  RECEIPT58_INK,
  RECEIPT58_STROKE,
  dots,
  receiptTextSx,
} from "./receipt58-tokens";

export interface Receipt58SignatureProps {
  /** 簽名人的角色(例:經手人簽名、收件人簽名)。 */
  signer: ReactNode;
}

/** 簽名欄(Figma `Draft/Receipt58Signature` 51:630):角色文字 + 下方留白 + 簽名線。 */
export const Receipt58Signature = ({ signer }: Receipt58SignatureProps) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: dots(44) }}>
    <Box component="p" sx={receiptTextSx("normal")}>
      {signer}
    </Box>
    <Box
      data-receipt58-sign-line=""
      sx={{
        width: "100%",
        borderTop: `${dots(RECEIPT58_STROKE)} solid`,
        borderColor: RECEIPT58_INK,
      }}
    />
  </Box>
);
