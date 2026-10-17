"use client";

import MuiTableCell from "@mui/material/TableCell";
import MuiTableSortLabel from "@mui/material/TableSortLabel";
import type { Header, RowData } from "@tanstack/react-table";

import { mergeSx } from "../theme/sx";
import { DataTableResizeHandle } from "./DataTableResizeHandle";
import type { DataTableColumn } from "./data-table-column";
import { type PinnedPlacement, pinnedCellSx } from "./pinned-cell-sx";
import type { DataTableFeatures } from "./useDataTable";

export interface DataTableHeaderCellProps<Row extends RowData> {
  header: Header<DataTableFeatures, Row>;
  column: DataTableColumn<Row>;
  placement: PinnedPlacement | undefined;
  resizeLabel: string;
  onKeyboardResize: (columnKey: string, width: number) => void;
}

const ariaSortOf = (sorted: false | "asc" | "desc") => {
  if (sorted === "asc") {
    return "ascending";
  }
  return sorted === "desc" ? "descending" : undefined;
};

/**
 * 表頭一格(`DataTable` 專用子元件):標題、排序鈕(`isSortable` 才有)、右緣的欄寬把手。
 * 樣式與 `Table` 的表頭一致(Figma Draft/TableHeaderCell 101:3)。
 */
export const DataTableHeaderCell = <Row extends RowData>({
  header,
  column,
  placement,
  resizeLabel,
  onKeyboardResize,
}: DataTableHeaderCellProps<Row>) => {
  const sorted = header.column.getIsSorted();
  const width = header.getSize();

  return (
    <MuiTableCell
      align={column.align}
      aria-sort={ariaSortOf(sorted)}
      sx={mergeSx(
        {
          typography: "subtitle2",
          color: "text.secondary",
          width,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
        pinnedCellSx(placement, true),
        column.headerSx,
      )}
    >
      {column.isSortable === true ? (
        <MuiTableSortLabel
          active={sorted !== false}
          direction={sorted === false ? "asc" : sorted}
          onClick={header.column.getToggleSortingHandler()}
        >
          {column.header}
        </MuiTableSortLabel>
      ) : (
        column.header
      )}
      {header.column.getCanResize() && (
        <DataTableResizeHandle
          label={resizeLabel}
          width={width}
          minWidth={header.column.columnDef.minSize ?? 0}
          isResizing={header.column.getIsResizing()}
          onDragStart={header.getResizeHandler()}
          onKeyboardResize={(next) => {
            onKeyboardResize(column.key, next);
          }}
        />
      )}
    </MuiTableCell>
  );
};
