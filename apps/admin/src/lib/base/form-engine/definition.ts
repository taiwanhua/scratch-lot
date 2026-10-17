import type {
  FieldDef,
  FormDefinition,
  Layout,
  Prefill,
  SummaryMap,
} from "@repo/domain/form";

/**
 * GraphQL 的定義四塊(`fields` / `layout` / `summaryMap` / `prefills` 以 JSON 進出)→ `@repo/domain/form` 的型別。
 * 形狀正本在 domain(Spec 6a §5),api 存之前已驗過;這裡只補「缺了就給空」的預設,不重驗。
 */
export interface RawDefinition {
  fields: readonly Record<string, unknown>[];
  layout: Record<string, unknown>;
  summaryMap: Record<string, unknown>;
  prefills: readonly Record<string, unknown>[];
}

const layoutOf = (raw: Record<string, unknown>): Layout => ({
  sections: Array.isArray(raw.sections)
    ? (raw.sections as Layout["sections"])
    : [],
});

const slotOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const summaryMapOf = (raw: Record<string, unknown>): SummaryMap => ({
  title: slotOf(raw.title),
  date: slotOf(raw.date),
  amount: slotOf(raw.amount),
});

export const definitionOf = (raw: RawDefinition): FormDefinition => ({
  fields: raw.fields as unknown as FieldDef[],
  layout: layoutOf(raw.layout),
  summaryMap: summaryMapOf(raw.summaryMap),
  prefills: raw.prefills as unknown as Prefill[],
});

/** 送回 api 的形狀(`JSONObject`):型別轉回自由物件。 */
export const rawOf = (
  definition: FormDefinition,
): {
  fields: Record<string, unknown>[];
  layout: Record<string, unknown>;
  summaryMap: Record<string, unknown>;
  prefills: Record<string, unknown>[];
} => ({
  fields: definition.fields as unknown as Record<string, unknown>[],
  layout: definition.layout as unknown as Record<string, unknown>,
  summaryMap: definition.summaryMap as unknown as Record<string, unknown>,
  prefills: definition.prefills as unknown as Record<string, unknown>[],
});

export const emptyDefinition = (): FormDefinition => ({
  fields: [],
  layout: { sections: [] },
  summaryMap: {},
  prefills: [],
});

/** 欄位 key → 定義。 */
export const fieldMapOf = (
  fields: readonly FieldDef[],
): ReadonlyMap<string, FieldDef> =>
  new Map(fields.map((field) => [field.key, field]));

/** `"[redacted]"`:讀者沒有 show 的欄位,api 回這個字串(不是 null,docs/modules/forms.md「輸出欄位」)。 */
export const REDACTED_VALUE = "[redacted]";

export const isRedactedValue = (value: unknown): boolean =>
  value === REDACTED_VALUE;
