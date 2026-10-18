"use client";

import MuiTable from "@mui/material/Table";
import MuiTableBody from "@mui/material/TableBody";
import MuiTableCell, {
  type TableCellProps as MuiTableCellProps,
} from "@mui/material/TableCell";
import MuiTableContainer from "@mui/material/TableContainer";
import MuiTableHead from "@mui/material/TableHead";
import MuiTableRow from "@mui/material/TableRow";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

import { CircularProgress } from "../CircularProgress/CircularProgress";
import {
  type CellRenderContext,
  type ColumnAccessor,
  cellValueOf,
} from "../DataTable/cell-render-context";
import { mergeSx } from "../theme/sx";
import { TableStatusRow } from "./TableStatusRow";

/** 一個欄位的宣告(Figma Draft/TableHeaderCell 101:3 + Draft/TableCell 101:9)。 */
export interface TableColumn<Row> {
  /** 欄位識別,同時作為 React key */
  key: string;
  /** 表頭內容 */
  header: ReactNode;
  /**
   * 依該列資料產生儲存格內容;複合內容(標籤、連結、動作)在此自行組合。
   * 選填的第二參數是與 `DataTable` 同形的渲染參數(REACT-13),只看 `row` 的既有寫法不必改。
   */
  render: (row: Row, ctx: CellRenderContext<Row>) => ReactNode;
  /** 取值方式,只用來填 `ctx.value`;沒給時 `ctx.value` 是 `undefined` */
  accessor?: ColumnAccessor<Row>;
  align?: NonNullable<MuiTableCellProps["align"]>;
  width?: number | string;
  /** Figma Emphasis=Strong:主要識別欄(如姓名)用較重字重 */
  isEmphasized?: boolean;
}

export interface TableProps<Row> {
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  /** 每列的唯一鍵;不要用陣列索引 */
  getRowKey: (row: Row) => string;
  /** 載入中:表身改顯示載入指示,不渲染任何列 */
  isLoading?: boolean;
  /** 沒有資料時的文案(預設「目前沒有資料」);載入中時不顯示 */
  emptyMessage?: ReactNode;
  /** 整列可點(如開啟明細);未給則列不可互動 */
  onRowClick?: (row: Row) => void;
  /**
   * 表格最小寬度:容器比它窄時改成橫向捲動,而不是把欄位擠成折行
   * (1280 寬的使用者清單被擠到每格都折行)。未給則跟著容器縮。
   */
  minWidth?: number | string;
  size?: "small" | "medium";
  /**
   * 疊加到捲動容器(`TableContainer`)上的樣式;預設是撐滿父層高度,
   * 少數場合(彈窗裡的小表、要限制最大高度)才由呼叫端覆寫。
   */
  containerSx?: SxProps<Theme>;
  "aria-label"?: string;
}

/**
 * 資料表格:表頭 / 列 / 空狀態 / 載入中四種狀態由本元件負責,分頁請搭配 `Pagination`。
 * 欄位以 `columns` 宣告(不是 children),頁面只描述「有哪些欄、每欄怎麼畫」。
 */
export const Table = <Row,>({
  columns,
  rows,
  getRowKey,
  isLoading = false,
  emptyMessage = "目前沒有資料",
  onRowClick,
  size = "medium",
  minWidth,
  containerSx,
  "aria-label": ariaLabel,
}: TableProps<Row>) => {
  const isEmpty = !isLoading && rows.length === 0;
  const isRowClickable = onRowClick !== undefined;

  return (
    // 容器撐滿父層(STYLE-08 的 `flex: 1; minHeight: 0` 欄)而不是只包到內容高度:
    // 列數少時橫向捲軸才落在面板底部,不會卡在最後一列下方。
    // 父層高度不確定時 `height: 100%` 自然退回 auto,維持原本的行為。
    <MuiTableContainer
      sx={mergeSx({ height: "100%", minHeight: 0 }, containerSx)}
    >
      <MuiTable size={size} sx={{ minWidth }} aria-label={ariaLabel}>
        <MuiTableHead>
          <MuiTableRow>
            {columns.map((column) => (
              <MuiTableCell
                key={column.key}
                align={column.align}
                width={column.width}
                sx={{ typography: "subtitle2", color: "text.secondary" }}
              >
                {column.header}
              </MuiTableCell>
            ))}
          </MuiTableRow>
        </MuiTableHead>
        <MuiTableBody>
          {isLoading && (
            <TableStatusRow colSpan={columns.length}>
              <CircularProgress size={24} aria-label="載入中" />
            </TableStatusRow>
          )}
          {isEmpty && (
            <TableStatusRow colSpan={columns.length}>
              {emptyMessage}
            </TableStatusRow>
          )}
          {!isLoading &&
            rows.map((row, index) => (
              <MuiTableRow
                key={getRowKey(row)}
                hover={isRowClickable}
                onClick={
                  isRowClickable
                    ? () => {
                        onRowClick(row);
                      }
                    : undefined
                }
                sx={{ cursor: isRowClickable ? "pointer" : undefined }}
              >
                {columns.map((column) => (
                  <MuiTableCell
                    key={column.key}
                    align={column.align}
                    sx={{
                      typography: column.isEmphasized ? "subtitle2" : "body2",
                    }}
                  >
                    {column.render(row, {
                      value: cellValueOf(column, row),
                      row,
                      rows,
                      index,
                      column,
                    })}
                  </MuiTableCell>
                ))}
              </MuiTableRow>
            ))}
        </MuiTableBody>
      </MuiTable>
    </MuiTableContainer>
  );
};
