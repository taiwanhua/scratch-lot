import { arrayColumnsOf, arrayRowsOf } from "./array";
import { temporalIsoOf } from "./temporal";
import type { FieldDef, StoredValues } from "./types";

/**
 * 儲存值 → **語意值**(表達式 `var` 拿到的東西):
 *
 * | type          | 存的值                        | 語意值    |
 * | ------------- | ----------------------------- | --------- |
 * | `select`      | `value` 或 `{ value, label }` | `value`   |
 * | `multiSelect` | 上者的陣列                    | `value[]` |
 * | `reference`   | `{ id, label }`               | `id`      |
 * | `upload`      | `{ path, name, … }`           | `name`    |
 * | `date` / `datetime` | `Date`(api)或 ISO 字串  | ISO 字串  |
 * | `array`       | `[{ rowId, 子欄: 存值 }]`     | 每列子欄的語意值(只給彙總與列內公式讀) |
 * | 其他          | 照存                          | 照存      |
 *
 * 所以 `{ "==": [{ "var": "leave_type" }, "sick"] }` 對 `{ value: "sick", label: "病假" }` 直接成立;
 * 要 label 只能用 `optionLabel(fieldKey)`。
 */
export function semanticValueOf(field: FieldDef, stored: unknown): unknown {
  if (stored === undefined || stored === null) {
    return null;
  }
  switch (field.type) {
    case "select": {
      return optionValueOf(stored);
    }
    case "multiSelect": {
      return Array.isArray(stored)
        ? stored.map((item) => optionValueOf(item))
        : null;
    }
    case "reference": {
      return propertyOf(stored, "id");
    }
    case "upload": {
      return propertyOf(stored, "name");
    }
    case "date":
    case "datetime": {
      // 表達式樹是純 JSON:時點一律以 ISO 字串比較 / 計算(api 讀出的 `Date` 在這裡轉)
      return temporalIsoOf(stored);
    }
    case "array": {
      return Array.isArray(stored)
        ? arrayRowsOf(stored).map((row) => semanticRowOf(field, row))
        : null;
    }
    default: {
      return stored;
    }
  }
}

/** 明細列的一列 → `{ rowId, 子欄: 語意值 }`(列內公式的 `row.*` 讀它)。 */
export function semanticRowOf(
  field: Pick<FieldDef, "type" | "columns">,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { rowId: row.rowId ?? null };
  for (const column of arrayColumnsOf(field)) {
    result[column.key] = semanticValueOf(column, row[column.key]);
  }
  return result;
}

/** 整筆 `values` → 語意值(只取定義裡有的欄位;沒存的欄位為 null)。 */
export function semanticValuesOf(
  fields: readonly FieldDef[],
  values: StoredValues,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.key] = semanticValueOf(field, values[field.key]);
  }
  return result;
}

/**
 * 選項欄的顯示名(`optionLabel` 與摘要槽 `title` 用):存 `{ value, label }` 的讀 label,
 * 靜態選項只存 `value` 的回版本定義裡的 label;multiSelect 回 label 陣列;reference 回快照 label。
 * 其他型別、或找不到 label → null。
 */
export function optionLabelOf(field: FieldDef, stored: unknown): unknown {
  if (stored === undefined || stored === null) {
    return null;
  }
  switch (field.type) {
    case "select": {
      return singleLabelOf(field, stored);
    }
    case "multiSelect": {
      return Array.isArray(stored)
        ? stored.map((item) => singleLabelOf(field, item))
        : null;
    }
    case "reference": {
      return propertyOf(stored, "label");
    }
    default: {
      return null;
    }
  }
}

function singleLabelOf(field: FieldDef, stored: unknown): unknown {
  const label = propertyOf(stored, "label");
  if (label !== null) {
    return label;
  }
  if (field.options?.kind === "static") {
    const item = field.options.items.find((option) => option.value === stored);
    return item?.label ?? null;
  }
  return null;
}

function optionValueOf(stored: unknown): unknown {
  return isRecord(stored) ? (stored.value ?? null) : stored;
}

function propertyOf(stored: unknown, key: string): unknown {
  return isRecord(stored) ? (stored[key] ?? null) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
