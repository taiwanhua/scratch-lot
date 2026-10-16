"use client";

import MuiTableCell from "@mui/material/TableCell";
import MuiTableRow from "@mui/material/TableRow";
import type { Cell, RowData, Row as TableRow } from "@tanstack/react-table";
import { memo } from "react";

import { mergeSx } from "../theme/sx";
import { displayValueOf } from "./cell-render-context";
import type { DataTableColumn } from "./data-table-column";
import { type PinnedPlacement, pinnedCellSx } from "./pinned-cell-sx";
import type { DataTableFeatures } from "./useDataTable";

export interface DataTableBodyRowProps<Row extends RowData> {
  row: TableRow<DataTableFeatures, Row>;
  /** 顯示順序(排序後) */
  index: number;
  /** 顯示順序的所有列(`ctx.rows`) */
  displayRows: readonly Row[];
  columnByKey: ReadonlyMap<string, DataTableColumn<Row>>;
  placementOf: (columnKey: string) => PinnedPlacement | undefined;
  /** 虛擬捲動量測列高 */
  measureElement: (element: Element | null) => void;
  /** 資料列之前的列數(表頭 + 固定列) */
  rowIndexOffset: number;
  onRowClick?: (row: Row) => void;
}

/**
 * 表身的一列(`DataTableBodyRows` 專用)。memo:捲動只改變可視範圍,已畫好的列 props 不變就不重畫;
 * 表格本身重新渲染(欄位、欄寬、欄位顯示、資料改變)時 `placementOf` / `columnByKey` 會換,列跟著重畫。
 */
const DataTableBodyRowInner = <Row extends RowData>({
  row,
  index,
  displayRows,
  columnByKey,
  placementOf,
  measureElement,
  rowIndexOffset,
  onRowClick,
}: DataTableBodyRowProps<Row>) => {
  const isRowClickable = onRowClick !== undefined;

  const renderCell = (cell: Cell<DataTableFeatures, Row>) => {
    const column = columnByKey.get(cell.column.id);
    if (column === undefined) {
      return null;
    }
    const value = cell.getValue();
    return (
      <MuiTableCell
        key={cell.id}
        align={column.align}
        sx={mergeSx(
          {
            typography: column.isEmphasized === true ? "subtitle2" : "body2",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
          pinnedCellSx(placementOf(column.key), false),
          column.cellSx,
        )}
      >
        {column.render === undefined
          ? displayValueOf(value)
          : column.render({
              value,
              row: row.original,
              rows: displayRows,
              index,
              column,
            })}
      </MuiTableCell>
    );
  };

  return (
    <MuiTableRow
      ref={measureElement}
      data-index={index}
      aria-rowindex={index + rowIndexOffset + 1}
      hover={isRowClickable}
      onClick={
        isRowClickable
          ? () => {
              onRowClick(row.original);
            }
          : undefined
      }
      sx={{ cursor: isRowClickable ? "pointer" : undefined }}
    >
      {row.getStartVisibleCells().map((cell) => renderCell(cell))}
      {row.getCenterVisibleCells().map((cell) => renderCell(cell))}
      <MuiTableCell aria-hidden sx={{ p: 0 }} />
      {row.getEndVisibleCells().map((cell) => renderCell(cell))}
    </MuiTableRow>
  );
};

export const DataTableBodyRow = memo(
  DataTableBodyRowInner,
) as typeof DataTableBodyRowInner;
