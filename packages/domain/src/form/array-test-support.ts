import { field } from "./form-test-support";
import type {
  ArrayColumnDef,
  ArrayColumnType,
  Expression,
  FieldDef,
} from "./types";

/** 測試夾具:子欄的預設元件(與 `ARRAY_COLUMN_WIDGETS` 的第一個一致)。 */
const COLUMN_WIDGET: Record<ArrayColumnType, string> = {
  text: "textField",
  number: "number",
  date: "datePicker",
  datetime: "dateTimePicker",
  select: "dropdown",
  boolean: "checkbox",
  reference: "referencePicker",
};

/** 一個最小可用的子欄;`overrides` 蓋掉任何屬性。 */
export function column(
  key: string,
  type: ArrayColumnType,
  overrides: Partial<ArrayColumnDef> = {},
): ArrayColumnDef {
  return {
    key,
    label: key,
    type,
    widget: { kind: COLUMN_WIDGET[type] },
    valueSource: { kind: "input" },
    ...(type === "number" ? { precision: 0 } : {}),
    ...(type === "select"
      ? {
          options: {
            kind: "static" as const,
            items: [{ value: "a", label: "甲", order: 1, enabled: true }],
          },
        }
      : {}),
    ...overrides,
  };
}

/** 列內公式子欄(數字)。 */
export function computedColumn(
  key: string,
  expr: Expression,
  precision = 0,
): ArrayColumnDef {
  return column(key, "number", {
    precision,
    valueSource: { kind: "computed", expr },
  });
}

/** 明細欄。 */
export function arrayField(
  key: string,
  columns: ArrayColumnDef[],
  overrides: Partial<FieldDef> = {},
): FieldDef {
  return field(key, "array", { columns, ...overrides });
}

/** 表單層的數字計算欄位。 */
export function computedNumber(
  key: string,
  expr: Expression,
  precision = 0,
): FieldDef {
  return field(key, "number", {
    precision,
    valueSource: { kind: "computed", expr },
  });
}

/** 固定的 `rowId`(UUID 格式):`rowIdOf(1)` = `00000000-0000-4000-8000-000000000001`。 */
export function rowIdOf(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
