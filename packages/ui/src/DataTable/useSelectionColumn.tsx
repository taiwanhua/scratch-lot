"use client";

import type { RowData } from "@tanstack/react-table";
import { useMemo } from "react";

import { Checkbox } from "../Checkbox/Checkbox";
import type { DataTableColumn } from "./data-table-column";
import {
  type DataTableRowSelection,
  type DataTableRowSelectionLabels,
  SELECTION_COLUMN_KEY,
  SELECTION_COLUMN_WIDTH,
  defaultSelectionLabels,
  togglePageSelection,
} from "./data-table-row-selection";

const stopPropagation = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

/**
 * 列勾選:沒開(`selection` 未給)時原樣回傳欄位;開了就在最前面插一個固定在左的勾選欄
 * (表頭 = 全選本頁,列 = 勾這一列;到上限時其他未勾的列停用)。勾選框的點擊不觸發 `onRowClick`。
 */
export const useSelectionColumn = <Row extends RowData>(
  columns: readonly DataTableColumn<Row>[],
  rows: readonly Row[],
  getRowKey: (row: Row) => string,
  selection: DataTableRowSelection<Row> | undefined,
): {
  columns: readonly DataTableColumn<Row>[];
  selectedKeys: ReadonlySet<string> | undefined;
  labels: DataTableRowSelectionLabels<Row>;
} => {
  const selectedKeys = selection?.selectedKeys;
  const labels: DataTableRowSelectionLabels<Row> = {
    ...(defaultSelectionLabels as DataTableRowSelectionLabels<Row>),
    ...selection?.labels,
  };
  const selectedSet = useMemo(
    () => (selectedKeys === undefined ? undefined : new Set(selectedKeys)),
    [selectedKeys],
  );

  if (selection === undefined || selectedSet === undefined) {
    return { columns, selectedKeys: undefined, labels };
  }

  const {
    onSelectedKeysChange,
    maxCount = Number.POSITIVE_INFINITY,
    isRowSelectable = () => true,
  } = selection;
  const isFull = selectedSet.size >= maxCount;
  const pageKeys = rows
    .filter((row) => isRowSelectable(row))
    .map((row) => getRowKey(row));
  const pageSelectedCount = pageKeys.filter((key) =>
    selectedSet.has(key),
  ).length;
  const canAddMore = !isFull || pageSelectedCount > 0;

  const selectionColumn: DataTableColumn<Row> = {
    key: SELECTION_COLUMN_KEY,
    width: SELECTION_COLUMN_WIDTH,
    minWidth: SELECTION_COLUMN_WIDTH,
    pinned: "left",
    isResizable: false,
    cellSx: { py: 0, px: 1, textOverflow: "clip" },
    headerSx: { py: 0, px: 1, textOverflow: "clip" },
    header: (
      <Checkbox
        size="small"
        checked={pageKeys.length > 0 && pageSelectedCount === pageKeys.length}
        indeterminate={
          pageSelectedCount > 0 && pageSelectedCount < pageKeys.length
        }
        disabled={pageKeys.length === 0 || !canAddMore}
        slotProps={{ input: { "aria-label": labels.selectPage } }}
        onChange={() => {
          onSelectedKeysChange(
            togglePageSelection(selection.selectedKeys, pageKeys, maxCount),
          );
        }}
      />
    ),
    render: ({ row }) => {
      const key = getRowKey(row);
      const isSelected = selectedSet.has(key);
      return (
        <Checkbox
          size="small"
          checked={isSelected}
          disabled={!isRowSelectable(row) || (!isSelected && isFull)}
          slotProps={{ input: { "aria-label": labels.selectRow(row) } }}
          onClick={stopPropagation}
          onChange={() => {
            onSelectedKeysChange(
              isSelected
                ? selection.selectedKeys.filter((one) => one !== key)
                : [...selection.selectedKeys, key],
            );
          }}
        />
      );
    },
  };

  return {
    columns: [selectionColumn, ...columns],
    selectedKeys: selectedSet,
    labels,
  };
};
