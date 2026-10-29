import {
  DEFAULT_TENANT_TIMEZONE,
  type FieldDef,
  type ListSlotKey,
  formatTemporalPattern,
  renderListTemplate,
  toInstant,
} from "@repo/domain/form";
import { ModuleListColumnKind } from "@repo/graphql";

import {
  type FormDisplayItemLike,
  type FormValueRenderContext,
  displayTextOf,
} from "./value-text";

/**
 * 列表欄位配置(`modules.settings.list`;`docs/modules/forms.md`「列表欄位配置」):
 * root 在「模組與權限」設定全域預設;沒設定過(空陣列)時用 `DEFAULT_LIST_COLUMNS`。
 *
 * 表單改版後配置可能引用到**那一筆綁的版本沒有的欄位**(或別張表單的欄位):不自動清,
 * 那一格顯示「—」(`resolveListCell` 回 `missing`)。
 *
 * 組合欄(`kind: TEMPLATE`,`key` 是模板):**前端依那一筆的值組字串**(`listTemplateTextOf`),每個佔位符照
 * 表單欄位欄同一套顯示規則(`displayTextOf`),值已由 api 依讀者的欄位級權限投影,讀不到的佔位符是空字串。
 */

/** 摘要槽 / 表單欄位 / 組合欄(GraphQL 的 `ModuleListColumnKind`)。 */
export type ListColumnKind = ModuleListColumnKind;

export interface ListColumnSpec {
  kind: ListColumnKind;
  /** 摘要槽 key、欄位 key,或組合欄的模板 */
  key: string;
  formKey?: string | null;
  /** 只有組合欄:表頭的欄名 */
  label?: string | null;
  width: number;
  order: number;
}

/**
 * 「摘要槽」欄可選的值(也是組合欄的槽佔位符):三個摘要槽(`form_submissions.summary`)加**單號**
 * (`serialNo`,表單設了單號格式、第一次送出時給;沒有號的那一格顯示「—」)。正本 `@repo/domain/form` 的 `LIST_SLOT_KEYS`。
 */
export { LIST_SLOT_KEYS as SUMMARY_SLOTS } from "@repo/domain/form";

export type SummarySlotKey = ListSlotKey;

/** api 驗的欄寬範圍(`setModuleListColumns`)。 */
export const LIST_COLUMN_WIDTH = { min: 40, max: 2000, default: 180 } as const;

export const DEFAULT_LIST_COLUMNS: readonly ListColumnSpec[] = [
  { kind: ModuleListColumnKind.Slot, key: "title", width: 240, order: 0 },
  { kind: ModuleListColumnKind.Slot, key: "date", width: 140, order: 1 },
];

export const sortedColumns = (
  columns: readonly ListColumnSpec[],
): ListColumnSpec[] =>
  (columns.length === 0 ? DEFAULT_LIST_COLUMNS : columns).toSorted(
    (a, b) => a.order - b.order,
  );

/** 欄位的識別(同一欄不能重複;表單欄位 / 組合欄的 formKey 不同算不同欄)。 */
export const columnIdOf = (column: ListColumnSpec): string => {
  if (column.kind === ModuleListColumnKind.Slot) {
    return `slot:${column.key}`;
  }
  const kind =
    column.kind === ModuleListColumnKind.Template ? "template" : "field";
  return `${kind}:${column.formKey ?? "*"}:${column.key}`;
};

export interface ListRowLike {
  formKey: string;
  version: number;
  values: Record<string, unknown>;
  /** 單號(沒給 / 沒設格式為 null) */
  serialNo?: string | null;
  summary?: {
    title?: string | null;
    date?: string | null;
    amount?: string | null;
  } | null;
}

export type ListCell =
  | { kind: "slot"; value: string | null }
  | { kind: "field"; field: FieldDef; value: unknown }
  /** 組合欄:那一筆綁的版本的欄位(組字串用 `listTemplateTextOf`) */
  | { kind: "template"; fields: readonly FieldDef[] }
  | { kind: "missing" };

/** 一筆的摘要槽 / 單號值(沒有為 null)。 */
const slotValueOf = (row: ListRowLike, slot: SummarySlotKey): string | null =>
  slot === "serialNo" ? (row.serialNo ?? null) : (row.summary?.[slot] ?? null);

const isOtherForm = (column: ListColumnSpec, row: ListRowLike): boolean =>
  column.formKey !== undefined &&
  column.formKey !== null &&
  column.formKey !== row.formKey;

/**
 * 一格要顯示什麼。`fieldsOf(formKey, version)` 回那一筆綁的版本的欄位定義(還沒載到回 undefined,
 * 也當作 missing —— 載到後重新渲染)。
 */
export const resolveListCell = (
  column: ListColumnSpec,
  row: ListRowLike,
  fieldsOf: (
    formKey: string,
    version: number,
  ) => readonly FieldDef[] | undefined,
): ListCell => {
  if (column.kind === ModuleListColumnKind.Slot) {
    return {
      kind: "slot",
      value: slotValueOf(row, column.key as SummarySlotKey),
    };
  }
  if (isOtherForm(column, row)) {
    return { kind: "missing" };
  }
  if (column.kind === ModuleListColumnKind.Template) {
    const fields = fieldsOf(row.formKey, row.version);
    return fields === undefined
      ? { kind: "missing" }
      : { kind: "template", fields };
  }
  const field = fieldsOf(row.formKey, row.version)?.find(
    (candidate) => candidate.key === column.key,
  );
  return field === undefined
    ? { kind: "missing" }
    : { kind: "field", field, value: row.values[column.key] ?? null };
};

/** 表頭要查的定義:表單 key + 那一版的欄位(還沒載到為 undefined)。 */
export interface HeaderDefinition {
  formKey: string;
  fields: readonly FieldDef[] | undefined;
}

/**
 * 表單欄位欄的表頭:依序在給的定義裡找第一個有這個欄位的(欄位限定了表單就只看那一張),回它的 label;
 * 都沒有回 null。列表先查各表單**目前版本**(沒有資料列也顯示欄位名),再查這一頁資料列綁的版本。
 */
export const fieldColumnLabelOf = (
  column: Pick<ListColumnSpec, "key" | "formKey">,
  definitions: readonly HeaderDefinition[],
): string | null => {
  for (const definition of definitions) {
    if (
      column.formKey !== undefined &&
      column.formKey !== null &&
      column.formKey !== definition.formKey
    ) {
      continue;
    }
    const field = definition.fields?.find(
      (candidate) => candidate.key === column.key,
    );
    if (field !== undefined) {
      return field.label;
    }
  }
  return null;
};

/** 組合欄組字串要的顯示規則(與同一列表的表單欄位欄、摘要槽欄同一套)。 */
export interface ListTemplateTextOptions {
  /** 那一筆這個欄位的 `displayValues[].items`(類別 / lookup 選項與引用欄的現名) */
  displayOf: (fieldKey: string) => readonly FormDisplayItemLike[];
  /** 「是 / 否」「(來源不可用)」(「—」不用:空的佔位符換空字串) */
  text: Omit<FormValueRenderContext["text"], "empty">;
  /** 讀者的租戶時區 */
  timezone?: string;
  /** 摘要槽 / 單號的顯示文字(例「日期」槽依版本印日期或日期時間) */
  slotText: (slot: SummarySlotKey, value: string) => string;
}

/** 日期 / 日期時間佔位符帶了格式字串:值是時點就照格式印(讀者時區);不是時點(沒值、讀不到)→ null,走一般顯示。 */
const formattedTemporalOf = (
  value: unknown,
  format: string | null,
  timezone: string | undefined,
): string | null =>
  format === null || toInstant(value) === null
    ? null
    : formatTemporalPattern(value, format, timezone ?? DEFAULT_TENANT_TIMEZONE);

/**
 * 組合欄的一格文字:槽佔位符取那一筆的摘要槽 / 單號(`slotText` 格式化)、欄位佔位符取那一筆綁的版本的欄位
 * 與值(`displayTextOf`,同表單欄位欄:選項 / 引用印名稱、日期依讀者時區、數字帶單位、是 / 否印文字);
 * 那一版沒有的欄位、沒值、讀不到(api 投影成 `"[redacted]"`)→ 空字串。套出來全空回空字串(呼叫端顯示「—」)。
 * 佔位符帶格式字串(`{{value.start_at|HH:mm}}`、`{{date|YYYY/MM/DD}}`)時,日期 / 日期時間依讀者時區照格式印;
 * 那一版的欄位已不是日期類(改版換了型別)就照一般顯示。
 */
export const listTemplateTextOf = (
  template: string,
  row: ListRowLike,
  fields: readonly FieldDef[],
  options: ListTemplateTextOptions,
): string =>
  renderListTemplate(template, (placeholder) => {
    if (placeholder.kind === "slot") {
      const value = slotValueOf(row, placeholder.slot);
      return value === null
        ? null
        : (formattedTemporalOf(value, placeholder.format, options.timezone) ??
            options.slotText(placeholder.slot, value));
    }
    const field = fields.find((candidate) => candidate.key === placeholder.key);
    if (field === undefined) {
      return null;
    }
    const value = row.values[field.key] ?? null;
    const formatted =
      field.type === "date" || field.type === "datetime"
        ? formattedTemporalOf(value, placeholder.format, options.timezone)
        : null;
    if (formatted !== null) {
      return formatted;
    }
    return displayTextOf({
      field,
      value,
      display: options.displayOf(field.key),
      text: { ...options.text, empty: "" },
      ...(options.timezone !== undefined && { timezone: options.timezone }),
    });
  });

/** 配置欄的表頭:摘要槽 → `slotLabel`、組合欄 → 欄名、表單欄位 → `fieldLabel`(查定義)。 */
export const listColumnHeaderOf = (
  column: ListColumnSpec,
  labels: {
    slotLabel: (slot: SummarySlotKey) => string;
    fieldLabel: (column: ListColumnSpec) => string;
  },
): string => {
  if (column.kind === ModuleListColumnKind.Slot) {
    return labels.slotLabel(column.key as SummarySlotKey);
  }
  if (column.kind === ModuleListColumnKind.Template) {
    return column.label ?? column.key;
  }
  return labels.fieldLabel(column);
};
