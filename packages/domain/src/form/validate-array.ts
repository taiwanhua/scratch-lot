import {
  ARRAY_COLUMN_RULES,
  ARRAY_COLUMN_WIDGETS,
  ARRAY_FIELD_RULES,
  MAX_ARRAY_COLUMNS,
  MAX_ARRAY_FIELDS,
  MAX_ARRAY_ROWS,
  arrayColumnsOf,
  arrayRowLimitsOf,
  isArrayColumnType,
} from "./array";
import {
  type DefinitionErrorCode,
  type DefinitionIssueLocation,
  IssueCollector,
} from "./issues";
import { checkFieldKey } from "./keys";
import type {
  ArrayColumnDef,
  ArrayColumnType,
  FieldDef,
  FieldRules,
} from "./types";
import {
  type FieldValidationContext,
  validateColumnContent,
} from "./validate-fields";

/**
 * 檢查器的明細列段(Spec 6a §5「明細列」的檢查器一條):至少一個子欄、子欄 key 格式與重複、
 * 白名單外的型別 / 元件 / 規則 / 設定、引用子欄的來源(同表單層引用欄)、硬上限(每版明細欄 5、子欄 20、`maxRows` 200)、列數規則
 * (`max(minRows, required ? 1 : 0) ≤ maxRows`)。版面 span、列內公式與彙總的引用、摘要槽 / 帶入 / 列表欄
 * 的禁用分別在版面段、表達式段與結構段檢查。
 */

/**
 * 子欄上不支援的設定:子欄級權限、顯示 / 鎖定條件、預設值、巢狀子欄(權限與條件繼承整個明細欄)。
 * 引用來源(`source`)只有引用子欄能設,另外檢查。
 */
const UNSUPPORTED_COLUMN_SETTINGS = [
  "permission",
  "visibleWhen",
  "readonlyWhen",
  "default",
  "columns",
] as const;

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function validateArrayFields(
  fields: readonly FieldDef[],
  context: FieldValidationContext,
  collector: IssueCollector,
): void {
  const arrays = fields.filter((field) => field.type === "array");
  for (const [index, field] of arrays.entries()) {
    if (index >= MAX_ARRAY_FIELDS) {
      collector.error(
        "ARRAY_LIMIT",
        `每個版本最多 ${String(MAX_ARRAY_FIELDS)} 個明細欄(「${field.label}」超過上限)`,
        { fieldKey: field.key },
      );
    }
    validateArraySettings(field, collector);
    validateRowRules(field, collector);
    validateColumns(field, context, collector);
  }
}

/** 明細欄本身:只能使用者填(沒有值來源 / 預設值 / 鎖定條件),規則只收必填與列數。 */
function validateArraySettings(
  field: FieldDef,
  collector: IssueCollector,
): void {
  const location = { fieldKey: field.key };
  if (field.valueSource.kind !== "input") {
    collector.error(
      "ARRAY_FIELD_SETTING",
      `明細欄「${field.label}」不能設公式或固定值`,
      { ...location, property: "valueSource" },
    );
  }
  if (isPresent(field.readonlyWhen)) {
    collector.error(
      "ARRAY_FIELD_SETTING",
      `明細欄「${field.label}」不能設鎖定條件`,
      { ...location, property: "readonlyWhen" },
    );
  }
  for (const key of Object.keys(field.rules ?? {})) {
    const value = (field.rules as Record<string, unknown>)[key];
    if (
      isPresent(value) &&
      !(ARRAY_FIELD_RULES as readonly string[]).includes(key)
    ) {
      collector.error(
        "ARRAY_FIELD_SETTING",
        `明細欄「${field.label}」不能設這個規則(${key})`,
        { ...location, property: `rules.${key}` },
      );
    }
  }
}

/** 列數:非負整數、`maxRows` ≤ 200、有效最低列數 ≤ `maxRows`。 */
function validateRowRules(field: FieldDef, collector: IssueCollector): void {
  const rules: FieldRules = field.rules ?? {};
  const location = { fieldKey: field.key };
  const minRows: unknown = rules.minRows;
  const maxRows: unknown = rules.maxRows;
  if (minRows !== undefined && !isNonNegativeInteger(minRows)) {
    collector.error(
      "ARRAY_ROWS_INVALID",
      `「${field.label}」的最少列數須為 0 以上的整數`,
      { ...location, property: "rules.minRows" },
    );
    return;
  }
  if (
    maxRows !== undefined &&
    (!isNonNegativeInteger(maxRows) || maxRows > MAX_ARRAY_ROWS)
  ) {
    collector.error(
      "ARRAY_ROWS_INVALID",
      `「${field.label}」的最多列數須為 0–${String(MAX_ARRAY_ROWS)} 的整數`,
      { ...location, property: "rules.maxRows" },
    );
    return;
  }
  const { min, max } = arrayRowLimitsOf(field);
  if (min > max) {
    collector.error(
      "ARRAY_ROWS_INVALID",
      `「${field.label}」的最少列數(必填算 1 列)不能超過最多列數 ${String(max)}`,
      { ...location, property: "rules.minRows" },
    );
  }
}

function validateColumns(
  field: FieldDef,
  context: FieldValidationContext,
  collector: IssueCollector,
): void {
  const columns = arrayColumnsOf(field);
  if (columns.length === 0) {
    collector.error(
      "ARRAY_COLUMNS_MISSING",
      `明細欄「${field.label}」至少要有一個子欄位`,
      { fieldKey: field.key, property: "columns" },
    );
    return;
  }
  if (columns.length > MAX_ARRAY_COLUMNS) {
    collector.error(
      "ARRAY_COLUMN_LIMIT",
      `明細欄「${field.label}」最多 ${String(MAX_ARRAY_COLUMNS)} 個子欄位`,
      { fieldKey: field.key, property: "columns" },
    );
  }
  const seen = new Set<string>();
  for (const column of columns) {
    const location = { fieldKey: field.key, columnKey: column.key };
    const keyCheck = checkFieldKey(column.key);
    if (!keyCheck.valid) {
      collector.error(
        "ARRAY_COLUMN_KEY",
        keyCheck.reason === "reserved"
          ? `「${field.label}」的子欄位 key ${column.key} 是保留字`
          : `「${field.label}」的子欄位 key ${column.key} 格式不符(小寫開頭,只允許小寫、數字、底線,最長 40)`,
        location,
      );
    }
    if (seen.has(column.key)) {
      collector.error(
        "ARRAY_COLUMN_KEY_DUPLICATE",
        `「${field.label}」的子欄位 key ${column.key} 重複`,
        location,
      );
    }
    seen.add(column.key);
    validateColumn(field, column, context, collector);
  }
}

function validateColumn(
  field: FieldDef,
  column: ArrayColumnDef,
  context: FieldValidationContext,
  collector: IssueCollector,
): void {
  const location = { fieldKey: field.key, columnKey: column.key };
  const type: unknown = column.type;
  if (!isArrayColumnType(type)) {
    collector.error(
      "ARRAY_COLUMN_TYPE",
      `子欄位「${column.label}」不能用 ${String(type)} 型別(只能文字、數字、日期、日期時間、單選、是否、引用)`,
      { ...location, property: "type" },
    );
    return;
  }
  if (!ARRAY_COLUMN_WIDGETS[type].includes(column.widget.kind)) {
    collector.error(
      "ARRAY_COLUMN_WIDGET",
      `子欄位「${column.label}」的元件 ${column.widget.kind} 不能用在 ${type} 型別`,
      { ...location, property: "widget.kind" },
    );
  }
  validateColumnSettings(column, type, location, collector);
  if (type === "select" && column.options?.kind === "lookup") {
    collector.error(
      "ARRAY_COLUMN_SETTING",
      `子欄位「${column.label}」的選項只能用靜態清單或欄位管理類別`,
      { ...location, property: "options" },
    );
    return;
  }
  validateColumnContentAt(column, location, context, collector);
}

/** 子欄的值來源:使用者填 / 列內公式(引用子欄只能使用者填);列內公式要有公式。 */
function validateColumnValueSource(
  column: ArrayColumnDef,
  type: ArrayColumnType,
  location: DefinitionIssueLocation,
  collector: IssueCollector,
): void {
  const source = column.valueSource as { kind?: unknown; expr?: unknown };
  if (source.kind !== "input" && source.kind !== "computed") {
    collector.error(
      "ARRAY_COLUMN_SETTING",
      `子欄位「${column.label}」只能使用者填或列內公式`,
      { ...location, property: "valueSource" },
    );
  } else if (type === "reference" && source.kind !== "input") {
    // 同表單層引用欄:值來源固定是使用者從來源挑選,不能用公式算
    collector.error(
      "ARRAY_COLUMN_SETTING",
      `引用子欄位「${column.label}」只能使用者填`,
      { ...location, property: "valueSource" },
    );
  } else if (source.kind === "computed" && source.expr === undefined) {
    collector.error("EXPR_MISSING", `子欄位「${column.label}」沒有公式`, {
      ...location,
      exprSlot: "valueSource.expr",
    });
  }
}

/** 子欄的值來源、不支援的設定、寬度、規則白名單。 */
function validateColumnSettings(
  column: ArrayColumnDef,
  type: ArrayColumnType,
  location: DefinitionIssueLocation,
  collector: IssueCollector,
): void {
  validateColumnValueSource(column, type, location, collector);
  const record = column as unknown as Record<string, unknown>;
  if (type !== "reference" && isPresent(record.source)) {
    collector.error(
      "ARRAY_COLUMN_SETTING",
      `子欄位「${column.label}」不支援這個設定(source)`,
      { ...location, property: "source" },
    );
  }
  for (const setting of UNSUPPORTED_COLUMN_SETTINGS) {
    if (isPresent(record[setting])) {
      collector.error(
        "ARRAY_COLUMN_SETTING",
        `子欄位「${column.label}」不支援這個設定(${setting})`,
        { ...location, property: setting },
      );
    }
  }
  if (
    isPresent(column.width) &&
    !(
      typeof column.width === "number" &&
      Number.isInteger(column.width) &&
      column.width > 0
    )
  ) {
    collector.error(
      "ARRAY_COLUMN_SETTING",
      `子欄位「${column.label}」的寬度須為正整數(px)`,
      { ...location, property: "width" },
    );
  }
  for (const key of Object.keys(column.rules ?? {})) {
    const value = (column.rules as Record<string, unknown>)[key];
    if (
      isPresent(value) &&
      !(ARRAY_COLUMN_RULES[type] as readonly string[]).includes(key)
    ) {
      collector.error(
        "ARRAY_COLUMN_SETTING",
        `子欄位「${column.label}」不能設這個規則(${key})`,
        { ...location, property: `rules.${key}` },
      );
    }
  }
}

/** 子欄內容檢查(小數位數、選項、正則、日期上下限);錯誤的定位換成「明細欄 + 子欄」。 */
function validateColumnContentAt(
  column: ArrayColumnDef,
  location: DefinitionIssueLocation,
  context: FieldValidationContext,
  collector: IssueCollector,
): void {
  const scoped = new IssueCollector();
  validateColumnContent(column, context, scoped);
  for (const issue of scoped.errors) {
    collector.error(issue.code as DefinitionErrorCode, issue.message, {
      ...issue.location,
      ...location,
    });
  }
}
