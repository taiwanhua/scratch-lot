import { coerceComputedResult, computeAll } from "./compute";
import { evaluateRaw } from "./expression";
import { referencedFieldKeys } from "./expression-shape";
import {
  type LookupFilterScalar,
  isLookupFilterVar,
  lookupFilterVarsOf,
  resolveLookupSource,
} from "./lookup-filter";
import { semanticValuesOf } from "./semantic";
import type {
  ExpressionContext,
  FieldDef,
  LookupSourceDescriptor,
  ProviderFieldDefault,
  StoredValues,
} from "./types";
import { isEmptyValue, normalizeFieldValue } from "./values";

/**
 * 欄位預設值的計算,前後端共用:
 *
 * - api 建草稿(`createFormDraft` / `copySubmissionToDraft`)時算一次,只填**使用者沒碰過且還空著**的欄位
 *   (不覆蓋送來的值與複製來源的值)
 * - admin 填寫時:使用者沒碰過的欄位,依賴的欄位變了就重算(覆蓋上一次的預設值);碰過就停
 *
 * 公式的結果照計算欄位同一條收斂成存值(`coerceComputedResult`);`reference` 的公式預設值只有系統值
 * 「填寫者 / 填寫者的組織」,存成 `{ id, label: null }`(label 由 api 送出時重取)。
 *
 * `reference` 的「來源提供的預設」(`provider`)要查資料,這裡不算:呼叫端給 `providerDefault`
 * (api 建草稿時查 lookup 來源、admin 用 `formLookupDefault` 查回來的結果);沒給 → 空。它的依賴 =
 * 預設值條件引用的欄位 + 引用欄自己連動篩選引用的欄位(查出來的那一筆也要通過來源的篩選)。
 */

/** 有預設值的欄位(只有使用者填的欄位才有)。 */
export function hasDefault(field: FieldDef): boolean {
  return (
    field.valueSource.kind === "input" &&
    field.default !== undefined &&
    field.default !== null
  );
}

/** 是不是「來源提供的預設」(只有引用欄才算;其他型別的 `provider` 由檢查器擋)。 */
export function isProviderDefault(
  field: FieldDef,
): field is FieldDef & { default: ProviderFieldDefault } {
  return (
    hasDefault(field) &&
    field.type === "reference" &&
    field.default?.kind === "provider"
  );
}

/**
 * 預設值依賴的欄位 key:公式引用到的欄位;來源提供的預設 = 預設值條件與引用欄連動篩選引用的欄位;
 * 其他回空陣列。
 */
export function defaultDependenciesOf(field: FieldDef): string[] {
  if (field.default?.kind === "expression") {
    return referencedFieldKeys(field.default.expr);
  }
  if (isProviderDefault(field)) {
    return [
      ...new Set(
        [
          ...lookupFilterVarsOf({
            provider: field.source?.provider ?? "",
            labelField: "",
            filter: field.default.filter ?? {},
          }),
          ...lookupFilterVarsOf(field.source),
        ].map((link) => link.fieldKey),
      ),
    ];
  }
  return [];
}

/**
 * 來源提供的預設要交給來源查的來源描述:引用欄的 `source`,連動篩選與預設值條件都換成目前的值、
 * 預設值條件併進 `filter`。任一被引用欄位沒有值、條件與來源的固定條件衝突、或不是來源提供的預設 → `null`
 * (此刻沒有預設值)。`valueOf(fieldKey)` 回那一欄的篩選值(存值用 `filterVarValueOf`)。
 */
export function providerDefaultSourceOf(
  field: FieldDef,
  valueOf: (fieldKey: string) => LookupFilterScalar | null,
): LookupSourceDescriptor | null {
  if (!isProviderDefault(field) || !field.source) {
    return null;
  }
  const conditions = field.default.filter ?? {};
  // 預設值條件只收連動條件(固定條件寫在來源的 `filter`;檢查器擋),形狀不對當沒有預設值
  if (!Object.values(conditions).every((value) => isLookupFilterVar(value))) {
    return null;
  }
  const source = resolveLookupSource(field.source, valueOf);
  const extra = resolveLookupSource(
    { ...field.source, filter: conditions },
    valueOf,
  );
  if (source === null || extra === null) {
    return null;
  }
  const filter: Record<string, unknown> = { ...source.filter };
  for (const [key, value] of Object.entries(extra.filter ?? {})) {
    if (Object.hasOwn(filter, key) && filter[key] !== value) {
      return null;
    }
    filter[key] = value;
  }
  return { ...source, filter };
}

/**
 * 來源提供的預設由呼叫端查好給(`provider` 種類):回存值形狀(引用 `{ id, label }`)或 null(沒有)。
 * `values` 是目前的存值(依賴欄位的預設值已經填上)。
 */
export type ProviderDefaultOf = (
  field: FieldDef,
  values: StoredValues,
) => unknown;

/**
 * 有預設值的欄位的計算順序:預設值公式引用到的、同樣有預設值的欄位排前面。
 * 成圈時(檢查器會先擋)圈上的依賴只走一次,不丟錯。
 */
export function defaultOrder(fields: readonly FieldDef[]): FieldDef[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const ordered: FieldDef[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (field: FieldDef): void => {
    if (state.has(field.key)) {
      return;
    }
    state.set(field.key, "visiting");
    for (const key of defaultDependenciesOf(field)) {
      const dependency = byKey.get(key);
      if (dependency && hasDefault(dependency)) {
        visit(dependency);
      }
    }
    state.set(field.key, "done");
    ordered.push(field);
  };
  for (const field of fields) {
    if (hasDefault(field)) {
      visit(field);
    }
  }
  return ordered;
}

/**
 * 一欄的預設值(存值形狀);沒有預設值回 `undefined`,算不出來 / 形狀不對回 `null`。
 * `values` 是目前的存值(計算欄位由這裡先算好再給公式看)。
 */
export function defaultValueOf(
  field: FieldDef,
  fields: readonly FieldDef[],
  values: StoredValues,
  ctx: ExpressionContext,
  providerDefault?: ProviderDefaultOf,
): unknown {
  if (!hasDefault(field) || !field.default) {
    return undefined;
  }
  if (field.default.kind === "provider") {
    return isProviderDefault(field)
      ? (providerDefault?.(field, values) ?? null)
      : null;
  }
  if (field.default.kind === "constant") {
    const result = normalizeFieldValue(
      field,
      field.default.value,
      ctx.timezone,
    );
    return result.ok ? result.value : null;
  }
  let raw: unknown;
  try {
    const stored = { ...values, ...computeAll(fields, { values, ctx }) };
    raw = evaluateRaw(field.default.expr, {
      values: semanticValuesOf(fields, stored),
      ctx,
      fields,
      stored,
    });
  } catch {
    // 形狀錯誤由檢查器擋;執行期的意外(型別不合、公式循環)一律視為算不出來
    return null;
  }
  if (field.type === "reference") {
    return typeof raw === "string" && raw !== ""
      ? { id: raw, label: null }
      : null;
  }
  return coerceComputedResult(field.type, field.precision, raw, ctx.timezone);
}

export interface ApplyDefaultsOptions {
  /** 使用者碰過的欄位 key:一律不動。 */
  touched?: Iterable<string>;
  /**
   * - `fill-empty`(api 建草稿):只填空著的欄位,不覆蓋送來 / 複製來的值
   * - `recompute`(admin 填寫中):沒碰過的欄位一律以目前的值重算(依賴變了就跟著變)
   */
  mode: "fill-empty" | "recompute";
  /** 來源提供的預設(`provider`)的值;不給 → 那些欄位算出空。 */
  providerDefault?: ProviderDefaultOf;
}

/**
 * 依序算每個有預設值的欄位,回**新的**存值(不改傳入的物件)。前一個欄位的預設值會給後面引用它的公式看。
 */
export function applyDefaults(
  fields: readonly FieldDef[],
  values: StoredValues,
  ctx: ExpressionContext,
  options: ApplyDefaultsOptions,
): StoredValues {
  const touched = new Set(options.touched);
  const next: StoredValues = { ...values };
  for (const field of defaultOrder(fields)) {
    if (touched.has(field.key)) {
      continue;
    }
    if (options.mode === "fill-empty" && !isEmptyValue(next[field.key])) {
      continue;
    }
    next[field.key] =
      defaultValueOf(field, fields, next, ctx, options.providerDefault) ?? null;
  }
  return next;
}
