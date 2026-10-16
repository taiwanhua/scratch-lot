import {
  type ColumnDef,
  type ColumnPinningState,
  type ColumnSizingState,
  type ColumnVisibilityState,
  type RowData,
  type SortingState,
  type Updater,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { cellValueOf } from "./cell-render-context";
import { compareCellValues, sortableValueOf } from "./compare-cell-values";
import {
  DEFAULT_COLUMN_MIN_WIDTH,
  DEFAULT_COLUMN_WIDTH,
  type DataTableColumn,
  type DataTableColumnVisibility,
  type DataTableColumnWidths,
  type DataTableSort,
} from "./data-table-column";

/** 只註冊用得到的功能(v9 以此決定 API 與 bundle 大小)。 */
export const dataTableFeatures = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

export type DataTableFeatures = typeof dataTableFeatures;

export interface UseDataTableOptions<Row extends RowData> {
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowKey: (row: Row) => string;
  sort?: DataTableSort | null;
  defaultSort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  isManualSorting?: boolean;
  columnWidths?: DataTableColumnWidths;
  onColumnWidthsChange?: (widths: DataTableColumnWidths) => void;
  columnVisibility?: DataTableColumnVisibility;
  onColumnVisibilityChange?: (visibility: DataTableColumnVisibility) => void;
}

const resolve = <Value>(updater: Updater<Value>, previous: Value): Value =>
  typeof updater === "function"
    ? (updater as (old: Value) => Value)(previous)
    : updater;

const toSorting = (sort: DataTableSort | null): SortingState =>
  sort === null ? [] : [{ id: sort.key, desc: sort.direction === "desc" }];

const fromSorting = (sorting: SortingState): DataTableSort | null => {
  const [first] = sorting;
  return first === undefined
    ? null
    : { key: first.id, direction: first.desc ? "desc" : "asc" };
};

/**
 * 把 `DataTable` 的 props 接到 TanStack Table:欄位宣告 → column defs、
 * 排序、欄寬與欄位顯示「給了就受控、沒給就內部管」、`pinned` → column pinning 狀態。
 */
export const useDataTable = <Row extends RowData>({
  columns,
  rows,
  getRowKey,
  sort: controlledSort,
  defaultSort = null,
  onSortChange,
  isManualSorting = false,
  columnWidths: controlledWidths,
  onColumnWidthsChange,
  columnVisibility: controlledVisibility,
  onColumnVisibilityChange,
}: UseDataTableOptions<Row>) => {
  const [innerSort, setInnerSort] = useState(defaultSort);
  const [innerWidths, setInnerWidths] = useState<DataTableColumnWidths>({});
  const sort = controlledSort === undefined ? innerSort : controlledSort;
  const widths = controlledWidths ?? innerWidths;
  const [innerVisibility, setInnerVisibility] =
    useState<DataTableColumnVisibility>({});
  const visibility = controlledVisibility ?? innerVisibility;

  const columnDefs = useMemo(
    () =>
      columns.map((column): ColumnDef<DataTableFeatures, Row> => ({
        id: column.key,
        accessorFn: (row) => sortableValueOf(cellValueOf(column, row)),
        size: column.width ?? DEFAULT_COLUMN_WIDTH,
        minSize: column.minWidth ?? DEFAULT_COLUMN_MIN_WIDTH,
        enableSorting: column.isSortable === true,
        sortUndefined: "last",
        sortFn: (rowA, rowB, columnId) =>
          compareCellValues(rowA.getValue(columnId), rowB.getValue(columnId)),
      })),
    [columns],
  );

  const columnPinning = useMemo<ColumnPinningState>(
    () => ({
      start: columns.filter((c) => c.pinned === "left").map((c) => c.key),
      end: columns.filter((c) => c.pinned === "right").map((c) => c.key),
    }),
    [columns],
  );

  const sorting = toSorting(sort);

  return useTable<DataTableFeatures, Row>({
    features: dataTableFeatures,
    columns: columnDefs,
    data: rows,
    getRowId: (row) => getRowKey(row),
    state: {
      sorting,
      columnSizing: widths,
      columnPinning,
      columnVisibility: visibility,
    },
    manualSorting: isManualSorting,
    enableMultiSort: false,
    // 一律先升冪(TanStack 預設數字欄先降冪,與「點一下 = 由小到大」的直覺不合)
    sortDescFirst: false,
    columnResizeMode: "onChange",
    onSortingChange: (updater) => {
      const next = fromSorting(resolve(updater, sorting));
      setInnerSort(next);
      onSortChange?.(next);
    },
    onColumnSizingChange: (updater) => {
      const next = resolve(updater, widths as ColumnSizingState);
      setInnerWidths(next);
      onColumnWidthsChange?.(next);
    },
    onColumnVisibilityChange: (updater) => {
      const next = resolve(updater, visibility as ColumnVisibilityState);
      setInnerVisibility(next);
      onColumnVisibilityChange?.(next);
    },
  });
};

export type DataTableInstance<Row extends RowData> = ReturnType<
  typeof useDataTable<Row>
>;
