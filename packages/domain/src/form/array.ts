import type {
  ArrayColumnDef,
  ArrayColumnType,
  ArrayRowValue,
  FieldDef,
  FieldRules,
} from "./types";

/**
 * 明細列(`array`)的共用常數與小工具(Spec 6a §5「明細列」):一個欄位裝多列同結構的子欄位,
 * 存 `[{ rowId, <子欄 key>: 值 }]`。檢查器、值正規化、計算、admin 的表格元件共用這一份。
 */

/** 每版明細欄的硬上限。 */
export const MAX_ARRAY_FIELDS = 5;

/** 每個明細欄的子欄硬上限。 */
export const MAX_ARRAY_COLUMNS = 20;

/** `rules.maxRows` 的硬上限(後端驗;提交大小另受修訂容量上限約束)。 */
export const MAX_ARRAY_ROWS = 200;

/** `rules.maxRows` 沒設時的列數上限。 */
export const DEFAULT_ARRAY_MAX_ROWS = 100;

/** 列內公式引用同一列子欄的 `var` 前綴:`{ "var": "row.qty" }`。 */
export const ROW_VAR_PREFIX = "row.";

/** `rowId` 的格式:前端 `crypto.randomUUID()` 產生的 UUID(大小寫都收)。 */
export const ARRAY_ROW_ID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

/** 子欄型別 → 可用的元件(每種一個:文字單行、數字、日期 / 日期時間選擇器、下拉、勾選框、引用的搜尋選擇器)。 */
export const ARRAY_COLUMN_WIDGETS: Readonly<
  Record<ArrayColumnType, readonly string[]>
> = {
  text: ["textField"],
  number: ["number"],
  date: ["datePicker"],
  datetime: ["dateTimePicker"],
  select: ["dropdown"],
  boolean: ["checkbox"],
  reference: ["referencePicker"],
};

/**
 * 子欄型別 → 可設的規則(必填、長度 / 數值 / 日期上下限、文字格式 / 正則;沒有自訂驗證、允許清單外的值)。
 * 白名單外的規則是檢查器錯誤。
 */
export const ARRAY_COLUMN_RULES: Readonly<
  Record<ArrayColumnType, readonly (keyof FieldRules)[]>
> = {
  text: [
    "required",
    "minLength",
    "maxLength",
    "pattern",
    "patternMessage",
    "format",
  ],
  number: ["required", "min", "max"],
  date: ["required", "min", "max"],
  datetime: ["required", "min", "max"],
  select: ["required"],
  boolean: ["required"],
  reference: ["required"],
};

/** 明細欄本身可設的規則。 */
export const ARRAY_FIELD_RULES: readonly (keyof FieldRules)[] = [
  "required",
  "minRows",
  "maxRows",
];

/** 彙總運算子(表單層公式 / 條件用):參數都是字面 key。 */
export const ARRAY_AGGREGATE_OPERATORS = [
  "sumOf",
  "countOf",
  "minOf",
  "maxOf",
  "avgOf",
] as const;

export type ArrayAggregateOperator = (typeof ARRAY_AGGREGATE_OPERATORS)[number];

export function isArrayAggregateOperator(
  operator: string,
): operator is ArrayAggregateOperator {
  return (ARRAY_AGGREGATE_OPERATORS as readonly string[]).includes(operator);
}

export function isArrayColumnType(type: unknown): type is ArrayColumnType {
  return (
    typeof type === "string" &&
    (Object.keys(ARRAY_COLUMN_WIDGETS) as readonly string[]).includes(type)
  );
}

/** 明細欄的子欄(不是明細欄或沒設 → 空陣列)。 */
export function arrayColumnsOf(
  field: Pick<FieldDef, "type" | "columns">,
): readonly ArrayColumnDef[] {
  return field.type === "array" && Array.isArray(field.columns)
    ? field.columns
    : [];
}

/**
 * 子欄當成 `FieldDef` 用(值的正規化、規則驗證、widget 都吃 FieldDef);`ArrayColumnDef` 本來就是它的子集。
 */
export function columnFieldOf(column: ArrayColumnDef): FieldDef {
  return column;
}

/** 依賴圖 / 錯誤定位用的子欄路徑:`items.subtotal`。 */
export function columnPathOf(arrayKey: string, columnKey: string): string {
  return `${arrayKey}.${columnKey}`;
}

export function isArrayRowId(value: unknown): value is string {
  return typeof value === "string" && ARRAY_ROW_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 存值 → 列(不是陣列回空陣列;不是物件的元素略過)。 */
export function arrayRowsOf(value: unknown): ArrayRowValue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (row): row is ArrayRowValue =>
      isRecord(row) && typeof row.rowId === "string",
  );
}

/**
 * 有效的列數範圍:下限 = `max(minRows, required ? 1 : 0)`、上限 = `maxRows`(沒設 = 預設上限)。
 * 設定本身不合法時照原值回,由檢查器報錯。
 */
export function arrayRowLimitsOf(field: Pick<FieldDef, "rules">): {
  min: number;
  max: number;
} {
  const rules = field.rules ?? {};
  const minRows = typeof rules.minRows === "number" ? rules.minRows : 0;
  const maxRows =
    typeof rules.maxRows === "number" ? rules.maxRows : DEFAULT_ARRAY_MAX_ROWS;
  return {
    min: Math.max(minRows, rules.required === true ? 1 : 0),
    max: maxRows,
  };
}
