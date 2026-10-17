import { arrayColumnsOf, arrayRowsOf } from "./array";
import { toDecimal } from "./decimal";
import { toInstant } from "./temporal";
import type { ArrayColumnDef, ArrayRowValue, FieldDef } from "./types";

/**
 * 明細列的修訂差異(Spec 6a §5「明細列」:以 `rowId` 對列,列的新增 / 刪除 / 移動 / 某格改值分別標示)。
 * 兩個修訂都存完整快照,差異在讀取時算(admin 修訂差異畫面用;api 測試以它驗快照保留 `rowId`)。
 *
 * - 新增:後一版有、前一版沒有的 `rowId`
 * - 刪除:前一版有、後一版沒有的 `rowId`
 * - 移動:兩版都有的列裡,**真正被搬動的**那幾列 —— 共有的列取前一版順序的最長遞增子序列(LIS)當作沒動,
 *   其餘標移動;所以 `[a, b, c] → [c, a, b]` 只有 c 是移動(順序 = 陣列順序持久化)
 * - 改值:兩版都有的列,某些子欄的值不同(比識別:選項比 value、引用比 id(label 快照不同不算)、數字比數值、日期比時點)
 *
 * 一列可以同時移動又改值。沒有任何變動的列不列出。
 */
export type ArrayRowChangeKind = "added" | "removed" | "kept";

export interface ArrayRowChange {
  rowId: string;
  kind: ArrayRowChangeKind;
  /** 只有 `kept`:在共有列之間的先後順序變了 */
  isMoved: boolean;
  /** 只有 `kept`:值不同的子欄 key(依子欄定義順序) */
  changedColumns: string[];
  before: ArrayRowValue | null;
  after: ArrayRowValue | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 一格值的識別(與「沒動」的判定同一個精神:比識別不比整個物件)。 */
function cellIdentity(column: ArrayColumnDef, value: unknown): string {
  if (value === undefined || [null, ""].includes(value as string | null)) {
    return "null";
  }
  if (column.type === "number") {
    return toDecimal(value)?.toString() ?? JSON.stringify(value);
  }
  if (column.type === "date" || column.type === "datetime") {
    const instant = toInstant(value);
    return instant === null ? JSON.stringify(value) : String(instant);
  }
  if (column.type === "reference") {
    return JSON.stringify(isRecord(value) ? (value.id ?? null) : value);
  }
  if (isRecord(value)) {
    return JSON.stringify(value.value ?? value.id ?? value);
  }
  return JSON.stringify(value);
}

/**
 * 沒動的列:`order` 是共有列在後一版的順序、值是它在前一版的位置;取最長遞增子序列,
 * 回傳留在原相對位置的 rowId(其餘都是被搬動的)。
 */
function unmovedRowIds(
  commonAfter: readonly string[],
  beforeIndex: ReadonlyMap<string, number>,
): Set<string> {
  const positions = commonAfter.map((id) => beforeIndex.get(id) ?? 0);
  // tails[k] = 長度 k + 1 的遞增子序列結尾在 positions 的索引;previous 用來回溯
  const tails: number[] = [];
  const previous: number[] = Array.from({ length: positions.length }, () => -1);
  for (const [index, position] of positions.entries()) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((positions[tails[middle] ?? 0] ?? 0) < position) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low > 0) {
      previous[index] = tails[low - 1] ?? -1;
    }
    tails[low] = index;
  }
  const kept = new Set<string>();
  let cursor = tails.at(-1) ?? -1;
  while (cursor !== -1) {
    kept.add(commonAfter[cursor] ?? "");
    cursor = previous[cursor] ?? -1;
  }
  return kept;
}

export function arrayRowChanges(
  field: Pick<FieldDef, "type" | "columns">,
  before: unknown,
  after: unknown,
): ArrayRowChange[] {
  const columns = arrayColumnsOf(field);
  const beforeRows = arrayRowsOf(before);
  const afterRows = arrayRowsOf(after);
  const beforeById = new Map(beforeRows.map((row) => [row.rowId, row]));
  const afterIds = new Set(afterRows.map((row) => row.rowId));
  const beforeIndex = new Map(
    beforeRows
      .filter((row) => afterIds.has(row.rowId))
      .map((row, index) => [row.rowId, index]),
  );
  const commonAfter = afterRows
    .map((row) => row.rowId)
    .filter((id) => beforeById.has(id));
  const unmoved = unmovedRowIds(commonAfter, beforeIndex);
  const changes: ArrayRowChange[] = [];
  for (const row of afterRows) {
    const previous = beforeById.get(row.rowId);
    if (previous === undefined) {
      changes.push({
        rowId: row.rowId,
        kind: "added",
        isMoved: false,
        changedColumns: [],
        before: null,
        after: row,
      });
      continue;
    }
    const isMoved = !unmoved.has(row.rowId);
    const changedColumns = columns
      .filter(
        (column) =>
          cellIdentity(column, previous[column.key]) !==
          cellIdentity(column, row[column.key]),
      )
      .map((column) => column.key);
    if (isMoved || changedColumns.length > 0) {
      changes.push({
        rowId: row.rowId,
        kind: "kept",
        isMoved,
        changedColumns,
        before: previous,
        after: row,
      });
    }
  }
  for (const row of beforeRows) {
    if (!afterIds.has(row.rowId)) {
      changes.push({
        rowId: row.rowId,
        kind: "removed",
        isMoved: false,
        changedColumns: [],
        before: row,
        after: null,
      });
    }
  }
  return changes;
}
