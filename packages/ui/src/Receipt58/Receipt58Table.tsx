"use client";

import Box from "@mui/material/Box";

import { type Receipt58Cells, Receipt58TableRow } from "./Receipt58TableRow";
import { RECEIPT58_GAP, dots } from "./receipt58-tokens";

export interface Receipt58TableProps {
  /** 表頭(最多 3 欄);不傳就不印表頭列。 */
  head?: Receipt58Cells;
  rows: readonly Receipt58Cells[];
}

/** 最多 3 欄的表格:表頭列 + 內容列(Figma `Draft/Receipt58TableRow` 組成)。 */
export const Receipt58Table = ({ head, rows }: Receipt58TableProps) => (
  <Box
    role="table"
    sx={{ display: "flex", flexDirection: "column", gap: dots(RECEIPT58_GAP) }}
  >
    {head === undefined ? null : <Receipt58TableRow kind="head" cells={head} />}
    {rows.map((cells, index) => (
      // 單據列是一次性的快照,沒有穩定 id;順序即身分
      <Receipt58TableRow key={index} cells={cells} />
    ))}
  </Box>
);
