"use client";

import MuiTableCell from "@mui/material/TableCell";
import MuiTableRow from "@mui/material/TableRow";
import type { SxProps, Theme } from "@mui/material/styles";
import type { Header, RowData } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { mergeSx } from "../theme/sx";
import type { DataTableColumn } from "./data-table-column";
import {
  type PinnedPlacement,
  pinnedCellSx,
  pinnedEdgeShadow,
} from "./pinned-cell-sx";
import type { DataTableFeatures } from "./useDataTable";

/**
 * 表頭下方、資料列上方的固定列(`DataTable` 的 `topRows`):和表頭一起固定、不隨資料列捲動,
 * 依欄位對齊(左右固定欄照樣固定)。不參與排序與虛擬捲動。
 */
export interface DataTableTopRow {
  key: string;
  /** 某一欄的格子內容;回 `null` 就是空格 */
  renderCell: (columnKey: string) => ReactNode;
}

/**
 * 格子底線改用 inset 陰影畫在格子裡:表格的格線是合併框線(border-collapse),半透明的 divider
 * 底下沒有格子的底色,固定在上方時捲過去的資料列會從那 1px 透出來。固定欄的分隔陰影一起疊上。
 */
const bottomLineSx =
  (placement?: PinnedPlacement): SxProps<Theme> =>
  (theme) => {
    const { divider } = (theme.vars ?? theme).palette;
    const line = `inset 0 -1px 0 ${divider}`;
    return {
      borderBottom: 0,
      boxShadow:
        placement?.isEdge === true
          ? `${line}, ${pinnedEdgeShadow(placement.side, divider)}`
          : line,
    };
  };

type LeafHeader<Row extends RowData> = Header<DataTableFeatures, Row>;

export interface DataTableTopRowsProps<Row extends RowData> {
  rows: readonly DataTableTopRow[];
  startHeaders: readonly LeafHeader<Row>[];
  centerHeaders: readonly LeafHeader<Row>[];
  endHeaders: readonly LeafHeader<Row>[];
  columnByKey: ReadonlyMap<string, DataTableColumn<Row>>;
  placementOf: (columnKey: string) => PinnedPlacement | undefined;
  /** 表頭佔掉的列數(`aria-rowindex` 從它之後接著數) */
  rowIndexOffset: number;
}

/** `DataTable` 專用子元件:畫 `topRows`(放在 `thead` 裡,跟著表頭固定)。 */
export const DataTableTopRows = <Row extends RowData>({
  rows,
  startHeaders,
  centerHeaders,
  endHeaders,
  columnByKey,
  placementOf,
  rowIndexOffset,
}: DataTableTopRowsProps<Row>) => {
  const renderCell = (row: DataTableTopRow, header: LeafHeader<Row>) => {
    const column = columnByKey.get(header.column.id);
    if (column === undefined) {
      return null;
    }
    const placement = placementOf(column.key);
    return (
      <MuiTableCell
        key={header.id}
        variant="body"
        component="td"
        align={column.align}
        sx={mergeSx(
          {
            typography: "body2",
            // 固定在表頭下方:要不透明底色,捲過去的資料列才不會透出來
            bgcolor: "background.paper",
            overflow: "hidden",
          },
          pinnedCellSx(placement, false),
          bottomLineSx(placement),
          column.cellSx,
        )}
      >
        {row.renderCell(column.key)}
      </MuiTableCell>
    );
  };

  return rows.map((row, index) => (
    <MuiTableRow key={row.key} aria-rowindex={rowIndexOffset + index + 1}>
      {startHeaders.map((header) => renderCell(row, header))}
      {centerHeaders.map((header) => renderCell(row, header))}
      <MuiTableCell
        aria-hidden
        variant="body"
        component="td"
        sx={mergeSx({ p: 0, bgcolor: "background.paper" }, bottomLineSx())}
      />
      {endHeaders.map((header) => renderCell(row, header))}
    </MuiTableRow>
  ));
};
