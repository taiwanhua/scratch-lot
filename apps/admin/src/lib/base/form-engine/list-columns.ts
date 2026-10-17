import type { FieldDef } from "@repo/domain/form";
import { ModuleListColumnKind } from "@repo/graphql";

/**
 * 列表欄位配置(`modules.settings.list`,Spec 6a §4;docs/modules/forms.md「列表欄位配置」):
 * root 在「模組與權限」設定全域預設;沒設定過(空陣列)時用 `DEFAULT_LIST_COLUMNS`。
 *
 * 表單改版後配置可能引用到**那一筆綁的版本沒有的欄位**(或別張表單的欄位):不自動清,
 * 那一格顯示「—」(`resolveListCell` 回 `missing`)。
 */

/** 摘要槽 / 表單欄位(GraphQL 的 `ModuleListColumnKind`)。 */
export type ListColumnKind = ModuleListColumnKind;

export interface ListColumnSpec {
  kind: ListColumnKind;
  key: string;
  formKey?: string | null;
  width: number;
  order: number;
}

export const SUMMARY_SLOTS = ["title", "date", "amount"] as const;

export type SummarySlotKey = (typeof SUMMARY_SLOTS)[number];

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

/** 欄位的識別(同一欄不能重複;表單欄位的 formKey 不同算不同欄)。 */
export const columnIdOf = (column: ListColumnSpec): string =>
  column.kind === ModuleListColumnKind.Slot
    ? `slot:${column.key}`
    : `field:${column.formKey ?? "*"}:${column.key}`;

export interface ListRowLike {
  formKey: string;
  version: number;
  values: Record<string, unknown>;
  summary?: {
    title?: string | null;
    date?: string | null;
    amount?: string | null;
  } | null;
}

export type ListCell =
  | { kind: "slot"; value: string | null }
  | { kind: "field"; field: FieldDef; value: unknown }
  | { kind: "missing" };

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
    const value = row.summary?.[column.key as SummarySlotKey] ?? null;
    return { kind: "slot", value };
  }
  if (
    column.formKey !== undefined &&
    column.formKey !== null &&
    column.formKey !== row.formKey
  ) {
    return { kind: "missing" };
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
