import {
  type FieldDef,
  type LookupFilterScalar,
  type LookupFilterVar,
  type StoredValues,
  arrayColumnsOf,
  arrayRowsOf,
  filterVarValueOf,
  lookupFilterVarsOf,
} from "@repo/domain/form";

/**
 * 連動篩選(《底座規格》3.2 B2d)填寫端的純邏輯:引用欄位的來源 `filter` 有 `{ var: "<欄位 key>" }` 時,
 * 查詢一併送被引用欄位目前的值;被引用欄位沒有值 → 引用欄停用;被引用欄位改值 → 清空依賴它的引用欄並提示。
 * 編輯既有單據打開時不清(只在改值的那一刻清)。
 */

/** 被引用欄位此刻的篩選值與標題(引用欄的查詢與「請先填」提示用)。 */
export interface FilterLinkValue {
  value: LookupFilterScalar | null;
  label: string;
}

export type FilterLinkValues = Readonly<Record<string, FilterLinkValue>>;

/** 依賴某欄位的一個引用欄(表單層引用欄,或明細的引用子欄)。 */
export interface LinkedReference {
  fieldKey: string;
  /** 明細引用子欄的子欄 key;表單層引用欄沒有 */
  columnKey?: string;
  label: string;
  vars: LookupFilterVar[];
}

/** 這一版有連動篩選的引用欄(表單層與明細子欄)。 */
export const linkedReferencesOf = (
  fields: readonly FieldDef[],
): LinkedReference[] =>
  fields.flatMap((field): LinkedReference[] => {
    if (field.type === "reference") {
      const vars = lookupFilterVarsOf(field.source);
      return vars.length === 0
        ? []
        : [{ fieldKey: field.key, label: field.label, vars }];
    }
    if (field.type !== "array") {
      return [];
    }
    return arrayColumnsOf(field).flatMap((column) => {
      const vars =
        column.type === "reference" ? lookupFilterVarsOf(column.source) : [];
      return vars.length === 0
        ? []
        : [
            {
              fieldKey: field.key,
              columnKey: column.key,
              label: column.label,
              vars,
            },
          ];
    });
  });

/** 被引用欄位的目前值(只列被引用的欄位;沒有連動篩選 = 空物件)。 */
export const filterLinkValuesOf = (
  fields: readonly FieldDef[],
  links: readonly LinkedReference[],
  values: StoredValues,
): Record<string, FilterLinkValue> => {
  const result: Record<string, FilterLinkValue> = {};
  for (const { fieldKey } of links.flatMap((link) => link.vars)) {
    const field = fields.find((candidate) => candidate.key === fieldKey);
    result[fieldKey] = {
      value: filterVarValueOf(field, values[fieldKey]),
      label: field?.label ?? fieldKey,
    };
  }
  return result;
};

/** 一個引用欄這次查詢要送的 `filterValues`;沒有連動篩選回 undefined。 */
export const filterValuesFor = (
  vars: readonly LookupFilterVar[],
  links: FilterLinkValues | undefined,
): Record<string, LookupFilterScalar | null> | undefined =>
  vars.length === 0
    ? undefined
    : Object.fromEntries(
        vars.map(({ fieldKey }) => [
          fieldKey,
          links?.[fieldKey]?.value ?? null,
        ]),
      );

/** 還沒填的被引用欄位標題(有值 = 這個引用欄可以查)。 */
export const missingLinksOf = (
  vars: readonly LookupFilterVar[],
  links: FilterLinkValues | undefined,
): string[] => [
  ...new Set(
    vars
      .filter(({ fieldKey }) => (links?.[fieldKey]?.value ?? null) === null)
      .map(({ fieldKey }) => links?.[fieldKey]?.label ?? fieldKey),
  ),
];

/** 改值後被清空的一個引用欄:明細子欄帶清了幾列。 */
export interface ClearedLink {
  label: string;
  rows?: number;
}

/**
 * 某欄改值:它的篩選值變了的話,清空依賴它的引用欄(表單層引用欄整欄、明細引用子欄每一列),回清了什麼。
 * 篩選值沒變(例:引用換成同一個 id、文字只改空白以外的同值)不清。
 */
export const clearLinkedReferences = (
  fields: readonly FieldDef[],
  links: readonly LinkedReference[],
  before: StoredValues,
  after: StoredValues,
  changedKey: string,
): { values: StoredValues; cleared: ClearedLink[] } => {
  const changed = fields.find((field) => field.key === changedKey);
  if (
    filterVarValueOf(changed, before[changedKey]) ===
    filterVarValueOf(changed, after[changedKey])
  ) {
    return { values: after, cleared: [] };
  }
  const values: StoredValues = { ...after };
  const cleared: ClearedLink[] = [];
  for (const link of links) {
    if (!link.vars.some((entry) => entry.fieldKey === changedKey)) {
      continue;
    }
    const current = values[link.fieldKey];
    if (link.columnKey === undefined) {
      if (current !== null && current !== undefined) {
        values[link.fieldKey] = null;
        cleared.push({ label: link.label });
      }
      continue;
    }
    const columnKey = link.columnKey;
    let count = 0;
    const rows = arrayRowsOf(current).map((row) => {
      if (row[columnKey] === null || row[columnKey] === undefined) {
        return row;
      }
      count += 1;
      return { ...row, [columnKey]: null };
    });
    if (count > 0) {
      values[link.fieldKey] = rows;
      cleared.push({ label: link.label, rows: count });
    }
  }
  return { values, cleared };
};
