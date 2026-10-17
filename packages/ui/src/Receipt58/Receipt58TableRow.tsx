"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import {
  RECEIPT58_TABLE_COL_WIDTHS,
  dots,
  receiptTextSx,
} from "./receipt58-tokens";

/** 一列的欄位:最多 3 欄(第 1 欄靠左填滿,第 2、3 欄靠右固定寬)。 */
export type Receipt58Cells =
  | readonly [ReactNode]
  | readonly [ReactNode, ReactNode]
  | readonly [ReactNode, ReactNode, ReactNode];

export interface Receipt58TableRowProps {
  cells: Receipt58Cells;
  /** 表頭列用小一級的粗體(Figma Kind=Head);預設 body。 */
  kind?: "head" | "body";
}

/** 表格列(Figma `Draft/Receipt58TableRow` 80:1508);欄內太長自動換行。 */
export const Receipt58TableRow = ({
  cells,
  kind = "body",
}: Receipt58TableRowProps) => {
  const textSx =
    kind === "head" ? receiptTextSx("small", true) : receiptTextSx("normal");
  const [first, ...rest] = cells;
  return (
    <Box
      role="row"
      sx={{ display: "flex", alignItems: "flex-start", gap: dots(8) }}
    >
      <Box
        component="span"
        role={kind === "head" ? "columnheader" : "cell"}
        sx={{ ...textSx, flex: 1, minWidth: 0 }}
      >
        {first}
      </Box>
      {rest.map((cell, index) => (
        <Box
          // 欄位位置固定(最多 3 欄),以位置當 key
          key={index}
          component="span"
          role={kind === "head" ? "columnheader" : "cell"}
          sx={{
            ...textSx,
            flexShrink: 0,
            width: dots(RECEIPT58_TABLE_COL_WIDTHS[index] ?? 0),
            textAlign: "right",
          }}
        >
          {cell}
        </Box>
      ))}
    </Box>
  );
};
