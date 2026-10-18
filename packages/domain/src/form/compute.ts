import { arrayColumnsOf, arrayRowsOf } from "./array";
import { FormDecimal, roundToPrecision } from "./decimal";
import { type ComputeNode, computeOrder } from "./dependencies";
import { evaluateRaw } from "./expression";
import { semanticRowOf, semanticValuesOf } from "./semantic";
import { startOfLocalDayOf, toInstant, toIso } from "./temporal";
import type {
  ArrayColumnDef,
  ExpressionContext,
  FieldDef,
  FieldType,
  StoredValues,
} from "./types";
import { normalizeFieldValue } from "./values";

/**
 * 計算欄位與固定值欄位的值(前端即時算供預覽,送出時後端重算並以後端為準)。
 * 本檔只管「算」;受保護守門等寫入規則由 api 依「不能填的四種原因」處理。
 * 被顯示條件隱藏的欄位在計算輸入裡一律是 null(`ComputeInput.hidden`;哪些欄位隱藏由 `settleHidden` 收斂)。
 */

/**
 * 把表達式結果轉成該型別的**存值**,轉不了 → null:
 * - number:取到 `precision` 位的十進位字串
 * - date:時點收斂成 `timezone`(租戶時區)那一天 00:00 的 ISO —— `now` 回的是此刻,不能原樣存進日期欄
 * - datetime:時點的 ISO(`toIso`)
 *
 * 日期 / 日期時間回 ISO 字串(JSON 形);api 存進 Mongo 前換成 `Date`。
 * - text / multiline:字串(decimal 不取位轉字串)
 */
export function coerceComputedResult(
  type: FieldType,
  precision: number | undefined,
  result: unknown,
  timezone = "UTC",
): unknown {
  if (result === null || result === undefined) {
    return null;
  }
  switch (type) {
    case "number": {
      return roundToPrecision(result, precision ?? 0);
    }
    case "boolean": {
      return typeof result === "boolean" ? result : null;
    }
    case "date":
    case "datetime": {
      return temporalResultOf(type, result, timezone);
    }
    case "text":
    case "multiline": {
      if (typeof result === "string") {
        return result;
      }
      // decimal 物件(算術結果)在這裡轉成不取位的字串
      if (result instanceof FormDecimal) {
        return result.toString();
      }
      return typeof result === "number" || typeof result === "boolean"
        ? String(result)
        : null;
    }
    default: {
      return null;
    }
  }
}

/** 日期 / 日期時間的結果;不是時點或時區不合法 → null。 */
function temporalResultOf(
  type: "date" | "datetime",
  result: unknown,
  timezone: string,
): string | null {
  const instant = toInstant(result);
  if (instant === null) {
    return null;
  }
  if (type === "datetime") {
    return toIso(instant);
  }
  try {
    return toIso(startOfLocalDayOf(instant, timezone));
  } catch {
    // 時區字串不合法
    return null;
  }
}

export interface ComputeInput {
  /** 目前的存值(使用者輸入 + 既有值)。 */
  values: StoredValues;
  ctx: ExpressionContext;
  /**
   * 被 `visibleWhen` 隱藏的欄位 key:計算輸入裡當 null(明細整欄 null,彙總視為空),
   * 它們自己也不算、結果一律 null(「不能填的四種原因」的第一項)。不給 = 都顯示。
   */
  hidden?: ReadonlySet<string>;
}

/** 隱藏的欄位換成 null(回新物件,不改傳入的值);前端狀態不清,只在計算輸入替換。 */
export function withHiddenAsNull(
  values: StoredValues,
  hidden: ReadonlySet<string>,
): StoredValues {
  const result: StoredValues = { ...values };
  for (const key of hidden) {
    result[key] = null;
  }
  return result;
}

/**
 * 算一個計算欄位;`semantic` 是算到此刻為止的語意值(含前面已算好的計算欄位)。
 * 非計算欄位回 undefined(呼叫端不該拿它來算)。
 */
export function computeField(
  field: FieldDef,
  fields: readonly FieldDef[],
  semantic: Record<string, unknown>,
  input: ComputeInput,
): unknown {
  if (field.valueSource.kind === "constant") {
    return constantValueOf(field, input.ctx.timezone);
  }
  if (field.valueSource.kind !== "computed") {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = evaluateRaw(field.valueSource.expr, {
      values: semantic,
      ctx: input.ctx,
      fields,
      stored: input.values,
    });
  } catch {
    // 形狀錯誤由檢查器擋;執行期的意外(型別不合)一律視為算不出來
    return null;
  }
  return coerceComputedResult(
    field.type,
    field.precision,
    raw,
    input.ctx.timezone,
  );
}

/**
 * 固定值欄位的存值:照欄位型別正規化(與使用者填的值同一條 `normalizeFieldValue`):number 依 `precision`
 * 取位、是 / 否要是布林(字串 `"true"` 不收)、多選要是陣列、日期收斂成租戶時區當天 00:00 的 ISO;
 * 型別不對 → null(檢查器以同一個判準報 `CONSTANT_VALUE_INVALID`,發布前擋下;存草稿照收,所以草稿預覽可能算成 null)。
 */
function constantValueOf(field: FieldDef, timezone: string): unknown {
  if (field.valueSource.kind !== "constant") {
    return null;
  }
  const normalized = normalizeFieldValue(
    field,
    field.valueSource.value ?? null,
    timezone,
  );
  return normalized.ok ? normalized.value : null;
}

/**
 * 算一列的一個列內公式子欄:`row.*` 讀同一列子欄的語意值,也可讀表單層欄位與 `ctx.*`;
 * 結果照子欄型別收斂(數字取到子欄的 `precision` —— 每個計算子欄都是自己的取位邊界)。
 */
function computeColumnCell(
  column: ArrayColumnDef,
  arrayField: FieldDef,
  row: Record<string, unknown>,
  fields: readonly FieldDef[],
  semantic: Record<string, unknown>,
  input: ComputeInput,
): unknown {
  if (column.valueSource.kind !== "computed") {
    return row[column.key] ?? null;
  }
  let raw: unknown;
  try {
    raw = evaluateRaw(column.valueSource.expr, {
      values: semantic,
      ctx: input.ctx,
      fields,
      stored: input.values,
      row: semanticRowOf(arrayField, row),
      rowColumns: arrayColumnsOf(arrayField),
    });
  } catch {
    return null;
  }
  return coerceComputedResult(
    column.type,
    column.precision,
    raw,
    input.ctx.timezone,
  );
}

/** 一個計算節點:表單層欄位回它的值;子欄節點回整個明細欄的新列(每列算這個子欄)。 */
function computeNode(
  node: ComputeNode,
  fields: readonly FieldDef[],
  stored: StoredValues,
  input: ComputeInput,
): unknown {
  const semantic = semanticValuesOf(fields, stored);
  const withStored = { ...input, values: stored };
  if (node.kind === "field") {
    return computeField(node.field, fields, semantic, withStored);
  }
  const rows = stored[node.field.key];
  if (!Array.isArray(rows)) {
    // 明細為 null(隱藏或沒有列):沒有格可以算
    return rows ?? null;
  }
  return arrayRowsOf(rows).map((row) => ({
    ...row,
    [node.column.key]: computeColumnCell(
      node.column,
      node.field,
      row,
      fields,
      semantic,
      withStored,
    ),
  }));
}

/**
 * 依**完整依賴圖**的拓樸順序算完全部計算欄位、明細的列內公式子欄與固定值欄位,
 * 回傳 `{ fieldKey: 存值 }`(只含這幾類欄位;有列內公式的明細欄回算好的整份列)。
 * 下游讀的是上游**取位後**的值(總額 = 各列取位後小計相加)。
 * `input.hidden` 裡的欄位當 null 參與計算,本身也回 null。
 * 公式引用成圈 → `ComputedCycleError`(檢查器應先擋)。
 */
export function computeAll(
  fields: readonly FieldDef[],
  input: ComputeInput,
): Record<string, unknown> {
  const hidden = input.hidden ?? new Set<string>();
  const results: Record<string, unknown> = {};
  const stored = withHiddenAsNull(input.values, hidden);
  for (const field of fields) {
    if (field.valueSource.kind === "constant") {
      results[field.key] = hidden.has(field.key)
        ? null
        : constantValueOf(field, input.ctx.timezone);
      stored[field.key] = results[field.key];
    }
  }
  for (const node of computeOrder(fields)) {
    const value = hidden.has(node.field.key)
      ? null
      : computeNode(node, fields, stored, input);
    results[node.field.key] = value;
    stored[node.field.key] = value;
  }
  return results;
}
