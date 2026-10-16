"use client";

import type { RowData } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo } from "react";

import { DataTableBodyRow } from "./DataTableBodyRow";
import { DataTableSpacerRow } from "./DataTableSpacerRow";
import type { DataTableColumn } from "./data-table-column";
import type { PinnedPlacement } from "./pinned-cell-sx";
import type { DataTableInstance } from "./useDataTable";

/** 單列高度的估計值(px):實際高度以量測為準,估得準只是讓捲軸一開始就接近正確 */
const ESTIMATED_ROW_HEIGHT = { small: 37, medium: 53 } as const;
/** 可視範圍外多畫幾列,快速捲動時不會先看到空白 */
const OVERSCAN = 8;

export interface DataTableBodyRowsProps<Row extends RowData> {
  table: DataTableInstance<Row>;
  columnByKey: ReadonlyMap<string, DataTableColumn<Row>>;
  placementOf: (columnKey: string) => PinnedPlacement | undefined;
  scrollElement: HTMLDivElement | null;
  size: "small" | "medium";
  onRowClick?: (row: Row) => void;
  /** 資料列之前的列數(表頭 + 固定列),`aria-rowindex` 從它之後接著數 */
  rowIndexOffset: number;
}

/**
 * 表身的資料列(`DataTable` 專用子元件):只渲染可視範圍內的列(`@tanstack/react-virtual`),
 * 上下以留白列撐高,原生表格版面(欄寬、sticky 固定欄)因此不受影響。
 * 每一列是 memo 過的 `DataTableBodyRow`:捲動時只畫新進入可視範圍的列(班表 1000 人 × 31 天)。
 */
export const DataTableBodyRows = <Row extends RowData>({
  table,
  columnByKey,
  placementOf,
  scrollElement,
  size,
  onRowClick,
  rowIndexOffset,
}: DataTableBodyRowsProps<Row>) => {
  const modelRows = table.getRowModel().rows;
  const displayRows = useMemo(
    () => modelRows.map((row) => row.original),
    [modelRows],
  );
  // useVirtualizer 回傳可變的實例,React Compiler 因此跳過本元件的自動 memo;
  // 本元件不把 virtualizer 的函式往下傳給 memo 過的子元件,略過 memo 不影響正確性
  // eslint-disable-next-line react-hooks/incompatible-library -- 見上兩行
  const virtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ESTIMATED_ROW_HEIGHT[size],
    getItemKey: (index) => modelRows[index]?.id ?? index,
    overscan: OVERSCAN,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom =
    items.length > 0
      ? virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0)
      : 0;
  // 固定欄 + 捲動區 + 補位欄(吃掉 minWidth 多出來的寬度)
  const colSpan = table.getAllLeafColumns().length + 1;

  return (
    <>
      <DataTableSpacerRow height={paddingTop} colSpan={colSpan} />
      {items.map((item) => {
        const row = modelRows[item.index];
        return row === undefined ? null : (
          <DataTableBodyRow
            key={row.id}
            row={row}
            index={item.index}
            displayRows={displayRows}
            columnByKey={columnByKey}
            placementOf={placementOf}
            measureElement={virtualizer.measureElement}
            rowIndexOffset={rowIndexOffset}
            onRowClick={onRowClick}
          />
        );
      })}
      <DataTableSpacerRow height={paddingBottom} colSpan={colSpan} />
    </>
  );
};
