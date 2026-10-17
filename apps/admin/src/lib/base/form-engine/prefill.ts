import type { FieldDef, Prefill, StoredValues } from "@repo/domain/form";

import { isEmptyDisplay } from "./value-text";

/**
 * 帶入(Spec 6a §5「帶入」):**一次性複製、之後可改**,不記錄帶入來源。
 * lookup 回的是**語意值**(選項給 value、多選給 value[]、引用給 id);寫進本表單時換回本欄的存值形狀:
 * 類別 / lookup 選項欄存 `{ value, label: null }`(label 由 api 在送出時重取寫快照),其餘照原值。
 */
export const storedFromLookup = (
  field: FieldDef,
  semantic: unknown,
): unknown => {
  if (semantic === null || semantic === undefined) {
    return null;
  }
  const isObjectOption =
    field.options?.kind === "fieldCategory" || field.options?.kind === "lookup";
  const optionOf = (item: unknown): unknown =>
    isObjectOption ? { value: String(item), label: null } : String(item);
  switch (field.type) {
    case "select": {
      return optionOf(semantic);
    }
    case "multiSelect": {
      return (Array.isArray(semantic) ? semantic : [semantic]).map((item) =>
        optionOf(item),
      );
    }
    case "number": {
      return typeof semantic === "number" ? String(semantic) : semantic;
    }
    default: {
      return semantic;
    }
  }
};

export interface PrefillRow {
  field: FieldDef;
  sourceField: string;
  /** 來源的語意值(被省略的受保護欄位為 undefined) */
  sourceValue: unknown;
  /** 本欄已有值:帶入會覆蓋 */
  willOverwrite: boolean;
}

/**
 * 帶入跳窗的對應表:每條 mapping 一列;**填寫者對該欄沒有 `edit` 資格的列不出現**、
 * 本表單沒有這一欄(草稿刪掉)的也不出現。
 */
export const prefillRowsOf = (
  prefill: Prefill,
  fields: readonly FieldDef[],
  record: Record<string, unknown>,
  current: StoredValues,
  canEdit: (fieldKey: string) => boolean,
): PrefillRow[] =>
  prefill.mapping.flatMap((entry) => {
    const field = fields.find((candidate) => candidate.key === entry.fieldKey);
    if (field === undefined || !canEdit(field.key)) {
      return [];
    }
    return [
      {
        field,
        sourceField: entry.sourceField,
        sourceValue: record[entry.sourceField],
        willOverwrite: !isEmptyDisplay(current[field.key]),
      },
    ];
  });

/** 勾選的列 → 要寫進表單的值(只帶來源有值的欄位)。 */
export const prefillPatchOf = (
  rows: readonly PrefillRow[],
  checked: ReadonlySet<string>,
): StoredValues =>
  Object.fromEntries(
    rows
      .filter(
        (row) => checked.has(row.field.key) && row.sourceValue !== undefined,
      )
      .map((row) => [
        row.field.key,
        storedFromLookup(row.field, row.sourceValue),
      ]),
  );
