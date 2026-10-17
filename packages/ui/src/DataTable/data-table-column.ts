import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

import type {
  CellRenderColumn,
  CellRenderContext,
} from "./cell-render-context";

/** `DataTable` 的欄位宣告(REACT-13)。 */
export interface DataTableColumn<Row> extends CellRenderColumn<Row> {
  /** 初始欄寬(px);欄寬由呼叫端受控時以 `columnWidths` 為準。未給時 160 */
  width?: number;
  /** 依渲染參數產生儲存格內容;未給時直接顯示 `ctx.value` */
  render?: (ctx: CellRenderContext<Row>) => ReactNode;
  /** 疊加到這一欄表身格(與 `topRows` 的格子)上的樣式(STYLE-07:只疊加) */
  cellSx?: SxProps<Theme>;
  /** 疊加到這一欄表頭格上的樣式 */
  headerSx?: SxProps<Theme>;
  /** `false` = 不能拖拉 / 鍵盤調整欄寬(不畫欄寬把手);預設可以 */
  isResizable?: boolean;
}

/** 單欄排序狀態;`null` 表示不排序(照 `rows` 原順序)。 */
export interface DataTableSort {
  key: string;
  direction: "asc" | "desc";
}

/** 欄寬狀態:欄位 key → px。只放被拖拉過(或呼叫端指定)的欄,其餘用欄位宣告的 `width`。 */
export type DataTableColumnWidths = Readonly<Record<string, number>>;

/**
 * 欄位顯示狀態:欄位 key → 是否顯示(TanStack column visibility)。沒列到的欄照常顯示;
 * 列到已不存在的欄位 key 會被忽略。
 */
export type DataTableColumnVisibility = Readonly<Record<string, boolean>>;

export const DEFAULT_COLUMN_WIDTH = 160;
export const DEFAULT_COLUMN_MIN_WIDTH = 64;
