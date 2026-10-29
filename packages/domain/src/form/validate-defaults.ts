import type { IssueCollector } from "./issues";
import type { LookupProviderRegistry } from "./registry";
import type { FieldDef, FieldType } from "./types";
import { normalizeFieldValue } from "./values";

/**
 * 檢查器的預設值段:
 *
 * - 只有「使用者填」的欄位能設;`upload` 沒有預設值
 * - 各型別能用的種類:文字 / 多行 / 數字 / 日期 / 日期時間 = 固定或公式;單選 / 多選 = 從選項挑(固定);
 *   是 / 否 = 固定;引用 = 系統值「填寫者 / 填寫者的組織」,或「來源提供的預設」(`provider`:來源登記時
 *   宣告了依操作者的預設值才能選,登錄表沒給就不驗 → `DEFAULT_PROVIDER_UNSUPPORTED`;條件的形狀與引用
 *   由連動篩選段 `validate-lookup-filters.ts` 驗)
 * - 固定值要是該型別的合法值;靜態選項的值必須在選項清單內
 * - 值來源「固定值」(`valueSource.value`)同一套判準(`CONSTANT_VALUE_INVALID`):計算時照型別正規化,
 *   型別不對會變成 null,所以在檢查器就擋
 *
 * 公式的形狀、引用、自我引用、循環與根型別由表達式段(`validate-expressions.ts`、
 * `validate-expression-types.ts`)以 `default.expr` 槽檢查。
 */

type DefaultKind = "constant" | "expression" | "provider";

const DEFAULT_KINDS: Readonly<Record<FieldType, readonly DefaultKind[]>> = {
  text: ["constant", "expression"],
  multiline: ["constant", "expression"],
  number: ["constant", "expression"],
  date: ["constant", "expression"],
  datetime: ["constant", "expression"],
  select: ["constant"],
  multiSelect: ["constant"],
  boolean: ["constant"],
  upload: [],
  reference: ["expression", "provider"],
  // 明細列第一版沒有預設值(整欄與子欄都沒有)
  array: [],
};

/** 引用欄的預設值只能是這兩個系統值。 */
export const REFERENCE_DEFAULT_PATHS = [
  "ctx.user.id",
  "ctx.user.orgId",
] as const;

/** 某型別的欄位能用哪幾種預設值(設計器面板與檢查器共用)。 */
export function defaultKindsOf(type: FieldType): readonly DefaultKind[] {
  return DEFAULT_KINDS[type];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ var: "ctx.user.id" }` / `{ var: ["ctx.user.orgId"] }` 這種「只有一個系統值」的公式。 */
function referenceDefaultPathOf(expr: unknown): string | null {
  if (!isRecord(expr) || Object.keys(expr).length !== 1) {
    return null;
  }
  const argument: unknown = expr.var;
  const path: unknown = Array.isArray(argument)
    ? (argument as unknown[])[0]
    : argument;
  return typeof path === "string" &&
    (REFERENCE_DEFAULT_PATHS as readonly string[]).includes(path)
    ? path
    : null;
}

/** 選項欄的一個預設值的識別(靜態選項存 value 字串;類別 / lookup 存 `{ value, label }`)。 */
function optionValueOf(item: unknown): unknown {
  return isRecord(item) ? item.value : item;
}

export function validateDefaults(
  fields: readonly FieldDef[],
  collector: IssueCollector,
  providers?: LookupProviderRegistry,
): void {
  for (const field of fields) {
    const fallback: unknown = field.default;
    if (fallback !== undefined && fallback !== null) {
      validateDefault(field, fallback, collector, providers);
    }
    if (field.valueSource.kind === "constant") {
      validateFixedValue(field, field.valueSource.value, collector);
    }
  }
}

/** 值來源「固定值」:型別不合法或不在靜態選項內 → `CONSTANT_VALUE_INVALID`。 */
function validateFixedValue(
  field: FieldDef,
  value: unknown,
  collector: IssueCollector,
): void {
  const problem = constantProblemOf(field, value);
  if (problem !== null) {
    collector.error(
      "CONSTANT_VALUE_INVALID",
      problem === "type"
        ? `「${field.label}」的固定值不是這個型別的合法值`
        : `「${field.label}」的固定值必須從選項裡挑`,
      { fieldKey: field.key, property: "valueSource.value" },
    );
  }
}

/** 固定的值(預設值或固定值)有什麼問題:型別不合法 / 不在靜態選項內;沒問題回 null。 */
function constantProblemOf(
  field: FieldDef,
  value: unknown,
): "type" | "option" | null {
  const normalized = normalizeFieldValue(field, value);
  if (!normalized.ok) {
    return "type";
  }
  if (
    (field.type === "select" || field.type === "multiSelect") &&
    field.options?.kind === "static" &&
    normalized.value !== null
  ) {
    const values = new Set(field.options.items.map((item) => item.value));
    const picked = Array.isArray(normalized.value)
      ? normalized.value
      : [normalized.value];
    if (picked.some((item) => !values.has(String(optionValueOf(item))))) {
      return "option";
    }
  }
  return null;
}

function validateDefault(
  field: FieldDef,
  fallback: unknown,
  collector: IssueCollector,
  providers: LookupProviderRegistry | undefined,
): void {
  const location = { fieldKey: field.key, property: "default" };
  if (field.valueSource.kind !== "input" || field.type === "upload") {
    collector.error(
      "DEFAULT_NOT_ALLOWED",
      field.type === "upload"
        ? `上傳欄位「${field.label}」不能設預設值`
        : `「${field.label}」不是使用者填的欄位,不能設預設值`,
      location,
    );
    return;
  }
  const kind = isRecord(fallback) ? fallback.kind : undefined;
  const kinds = DEFAULT_KINDS[field.type] as readonly unknown[];
  if (!kinds.includes(kind)) {
    collector.error(
      "DEFAULT_KIND_INVALID",
      `「${field.label}」的預設值不能用這種設定`,
      location,
    );
    return;
  }
  if (kind === "provider") {
    const provider = field.source?.provider;
    const spec = provider === undefined ? undefined : providers?.[provider];
    // 來源不存在由引用欄的來源檢查報(`LOOKUP_UNKNOWN_PROVIDER` / `REFERENCE_SOURCE_MISSING`)
    if (spec !== undefined && spec.operatorDefault !== true) {
      collector.error(
        "DEFAULT_PROVIDER_UNSUPPORTED",
        `引用欄位「${field.label}」的來源沒有提供預設值`,
        location,
      );
    }
    return;
  }
  if (kind === "constant") {
    validateConstantDefault(
      field,
      (fallback as { value?: unknown }).value,
      collector,
    );
    return;
  }
  const expr = (fallback as { expr?: unknown }).expr;
  if (expr === undefined) {
    collector.error(
      "DEFAULT_KIND_INVALID",
      `「${field.label}」的預設值公式是空的`,
      location,
    );
  } else if (
    field.type === "reference" &&
    referenceDefaultPathOf(expr) === null
  ) {
    collector.error(
      "DEFAULT_REFERENCE_INVALID",
      `引用欄位「${field.label}」的預設值只能是「填寫者」或「填寫者的組織」`,
      { ...location, exprSlot: "default.expr", exprPath: "" },
    );
  }
}

function validateConstantDefault(
  field: FieldDef,
  value: unknown,
  collector: IssueCollector,
): void {
  const problem = constantProblemOf(field, value);
  if (problem !== null) {
    collector.error(
      "DEFAULT_VALUE_INVALID",
      problem === "type"
        ? `「${field.label}」的預設值不是這個型別的合法值`
        : `「${field.label}」的預設值必須從選項裡挑`,
      { fieldKey: field.key, property: "default.value" },
    );
  }
}
