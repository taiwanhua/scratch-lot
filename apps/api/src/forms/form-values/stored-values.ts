import {
  type FieldDef,
  type StoredValues,
  arrayColumnsOf,
  arrayRowsOf,
  semanticValuesOf,
  toInstant,
} from "@repo/domain/form";

const NUMERIC = /^(-?)(\d+)(?:\.(\d+))?$/;

/** 十進位字串的正規形(去掉小數尾端的 0):"1" 與 "1.00" 是同一個數。不是數字回 null。 */
function canonicalNumber(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") {
    return null;
  }
  const match = NUMERIC.exec(text);
  if (!match) {
    return null;
  }
  const [, sign = "", integer = "0", fraction = ""] = match;
  let start = 0;
  while (start < integer.length - 1 && integer[start] === "0") {
    start += 1;
  }
  let end = fraction.length;
  while (end > 0 && fraction[end - 1] === "0") {
    end -= 1;
  }
  const trimmedInteger = integer.slice(start);
  const trimmedFraction = fraction.slice(0, end);
  const body =
    trimmedFraction === ""
      ? trimmedInteger
      : `${trimmedInteger}.${trimmedFraction}`;
  return body === "0" ? "0" : `${sign}${body}`;
}

/**
 * 存值的小工具(寫入管線、投影、預覽共用)。
 */

/** 受保護欄位對沒有 `show` 的讀者一律投影成這個字串。 */
export const REDACTED = "[redacted]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined;
}

/** 選項值的識別:字串本身,或 `{ value }` 的 value。 */
function optionIdentity(value: unknown): unknown {
  return isRecord(value) ? value.value : value;
}

/**
 * 兩個存值是不是「同一個值」(無 `edit` 者送來的值與既有不同 → 403):
 * 比的是**識別**而不是整個物件 —— 選項比 value、引用比 id、上傳比 path、數字比數值、日期 / 日期時間比時點
 * (存的是 `Date`、送來的是 ISO 字串);
 * 前端把 `{ value, label }` 送成 `"value"`、label 快照不同,都不算改動。
 * 明細列比**列集合與順序**(`rowId` 逐列對上)與每一列的 input 子欄;列內公式子欄由後端重算,不比。
 */
export function isSameStoredValue(
  field: FieldDef,
  left: unknown,
  right: unknown,
): boolean {
  if (isEmpty(left) || isEmpty(right)) {
    return isEmpty(left) && isEmpty(right);
  }
  const a = left as NonNullable<unknown>;
  const b = right as NonNullable<unknown>;
  switch (field.type) {
    case "select": {
      return optionIdentity(a) === optionIdentity(b);
    }
    case "multiSelect": {
      // 多選是集合:順序不同不算改動
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
      }
      const left = new Set(a.map((item) => optionIdentity(item)));
      const right = new Set(b.map((item) => optionIdentity(item)));
      return (
        left.size === right.size && [...left].every((item) => right.has(item))
      );
    }
    case "reference": {
      return isRecord(a) && isRecord(b) && a.id === b.id;
    }
    case "upload": {
      return isRecord(a) && isRecord(b) && a.path === b.path;
    }
    case "number": {
      const normalized = canonicalNumber(a);
      return normalized !== null && normalized === canonicalNumber(b);
    }
    case "date":
    case "datetime": {
      const instant = toInstant(a);
      return instant === null ? a === b : instant === toInstant(b);
    }
    case "array": {
      return isSameRows(field, a, b);
    }
    default: {
      return a === b;
    }
  }
}

function isSameRows(field: FieldDef, left: unknown, right: unknown): boolean {
  const leftRows = arrayRowsOf(left);
  const rightRows = arrayRowsOf(right);
  if (leftRows.length !== rightRows.length) {
    return false;
  }
  const inputs = arrayColumnsOf(field).filter(
    (column) => column.valueSource.kind === "input",
  );
  return leftRows.every((row, index) => {
    const other = rightRows[index];
    return (
      other?.rowId === row.rowId &&
      inputs.every((column) =>
        isSameStoredValue(column, row[column.key], other[column.key]),
      )
    );
  });
}

/** 存值 → 表達式看到的語意值(`@repo/domain/form` 的 `semanticValuesOf`)。 */
export function semanticOf(
  fields: readonly FieldDef[],
  values: StoredValues,
): Record<string, unknown> {
  return semanticValuesOf(fields, values);
}
