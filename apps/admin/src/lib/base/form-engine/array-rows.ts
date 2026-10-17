import {
  type ArrayColumnDef,
  type ArrayRowValue,
  type FieldDef,
  columnPathOf,
} from "@repo/domain/form";

import { storedFromLookup } from "./prefill";

/**
 * 明細列(`array`)填寫時的列操作(純函式;`ArrayTableWidget` 與測試共用,Spec 6a §5「明細列」):
 * 每列 `{ rowId, <子欄 key>: 值 }`,`rowId` 在建列時以 `crypto.randomUUID()` 產生、之後不變;
 * 「複製列」「上方插入一列」產生新的 `rowId`;順序 = 陣列順序(上移 / 下移只換位置、`rowId` 不變,不做拖拉排序)。
 */

export const newRowId = (): string => globalThis.crypto.randomUUID();

/** 新的一列:每個子欄都是空值。 */
export const emptyRowOf = (
  columns: readonly ArrayColumnDef[],
): ArrayRowValue => {
  const row: ArrayRowValue = { rowId: newRowId() };
  for (const column of columns) {
    row[column.key] = null;
  }
  return row;
};

/** 複製一列,插在它的下一列(新的 `rowId`,其餘照抄)。 */
export const duplicateRowIn = (
  rows: readonly ArrayRowValue[],
  rowId: string,
): ArrayRowValue[] => {
  const index = rows.findIndex((row) => row.rowId === rowId);
  if (index === -1) {
    return [...rows];
  }
  return [
    ...rows.slice(0, index + 1),
    { ...rows[index], rowId: newRowId() },
    ...rows.slice(index + 1),
  ];
};

/** 在某列的上方插入一列空白列(找不到該列時原樣回傳)。 */
export const insertRowBefore = (
  rows: readonly ArrayRowValue[],
  rowId: string,
  columns: readonly ArrayColumnDef[],
): ArrayRowValue[] => {
  const index = rows.findIndex((row) => row.rowId === rowId);
  if (index === -1) {
    return [...rows];
  }
  return [...rows.slice(0, index), emptyRowOf(columns), ...rows.slice(index)];
};

/**
 * 把某列往上(`-1`)或往下(`1`)移一格;已在頭 / 尾、或找不到該列時原樣回傳。
 * 只換位置,`rowId` 與值不變(修訂差異以 `rowId` 對列,標成「移動」)。
 */
export const moveRow = (
  rows: readonly ArrayRowValue[],
  rowId: string,
  offset: -1 | 1,
): ArrayRowValue[] => {
  const from = rows.findIndex((row) => row.rowId === rowId);
  const to = from + offset;
  if (from === -1 || to < 0 || to >= rows.length) {
    return [...rows];
  }
  return rows.map((row, index) => {
    if (index === from) {
      return rows[to];
    }
    return index === to ? rows[from] : row;
  });
};

export const removeRowIn = (
  rows: readonly ArrayRowValue[],
  rowId: string,
): ArrayRowValue[] => rows.filter((row) => row.rowId !== rowId);

export const setCellIn = (
  rows: readonly ArrayRowValue[],
  rowId: string,
  columnKey: string,
  value: unknown,
): ArrayRowValue[] =>
  rows.map((row) =>
    row.rowId === rowId ? { ...row, [columnKey]: value } : row,
  );

/**
 * 一格的填寫元件吃的欄位定義:子欄本身,只把 key 換成 `<明細 key>.<子欄 key>` ——
 * 類別選項的查詢(`formFieldOptions`)與顯示名(`displayValues`)都以這個路徑指到子欄。
 */
export const cellFieldOf = (
  arrayKey: string,
  column: ArrayColumnDef,
): FieldDef => ({ ...column, key: columnPathOf(arrayKey, column.key) });

/**
 * 列內帶入(《底座規格》3.2 B2c):引用子欄選定 / 改選時,存下引用值,並依子欄的帶入規則把來源欄位
 * 帶進**同一列**的其他子欄(一次更新;覆蓋原值,之後可手動改)。來源被省略的欄位(受保護且無權)不動。
 * 複製列、複製為新單不走這裡(保留值、不重新帶入)。
 */
export const pickReferenceIn = (
  rows: readonly ArrayRowValue[],
  rowId: string,
  column: ArrayColumnDef,
  columns: readonly ArrayColumnDef[],
  value: unknown,
  sourceValues: Readonly<Record<string, unknown>>,
): ArrayRowValue[] =>
  rows.map((row) => {
    if (row.rowId !== rowId) {
      return row;
    }
    const next: ArrayRowValue = { ...row, [column.key]: value };
    for (const entry of column.prefill?.mapping ?? []) {
      const target = columns.find(
        (candidate) => candidate.key === entry.fieldKey && candidate !== column,
      );
      if (
        target !== undefined &&
        sourceValues[entry.sourceField] !== undefined
      ) {
        next[target.key] = storedFromLookup(
          target,
          sourceValues[entry.sourceField],
        );
      }
    }
    return next;
  });
