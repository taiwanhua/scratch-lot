"use client";

import Box from "@mui/material/Box";

import { RECEIPT58_INK, RECEIPT58_STROKE, dots } from "./receipt58-tokens";

/** 區段分隔虛線(Figma `Draft/Receipt58Divider` 80:1515)。 */
export const Receipt58Divider = () => (
  <Box
    component="hr"
    sx={{
      m: 0,
      width: "100%",
      border: 0,
      borderTop: `${dots(RECEIPT58_STROKE)} dashed`,
      borderColor: RECEIPT58_INK,
    }}
  />
);
