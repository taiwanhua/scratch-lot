import {
  type ExpressionContext,
  type FieldDef,
  type LookupFilterScalar,
  type LookupFilterVar,
  type StoredValues,
  arrayColumnsOf,
  arrayRowsOf,
  filterVarValueOf,
  lookupFilterVarsOf,
  settleHidden,
} from "@repo/domain/form";

/**
 * 連動篩選填寫端的純邏輯:引用欄位的來源 `filter` 有 `{ var: "<欄位 key>" }` 時,
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
/** 清空依賴 `changed` 任一欄的引用欄(已經是空的不算)。 */
const clearDependents = (
  links: readonly LinkedReference[],
  current: StoredValues,
  changed: ReadonlySet<string>,
): { values: StoredValues; cleared: ClearedLink[] } => {
  const values: StoredValues = { ...current };
  const cleared: ClearedLink[] = [];
  for (const link of links) {
    if (!link.vars.some((entry) => changed.has(entry.fieldKey))) {
      continue;
    }
    const value = values[link.fieldKey];
    if (link.columnKey === undefined) {
      if (value !== null && value !== undefined) {
        values[link.fieldKey] = null;
        cleared.push({ label: link.label });
      }
      continue;
    }
    const columnKey = link.columnKey;
    let count = 0;
    const rows = arrayRowsOf(value).map((row) => {
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

/** 條件與計算收斂後的值(計算欄位也可能被引用);公式成圈時退回原值。 */
const effectiveOf = (
  fields: readonly FieldDef[],
  values: StoredValues,
  ctx: ExpressionContext,
): StoredValues => {
  try {
    return settleHidden(fields, { values, ctx }).values;
  } catch {
    return values;
  }
};

/**
 * 值變了(使用者改值、帶入規則、預設值或計算欄位跟著變):被引用欄位的**篩選值**和改之前不同的,
 * 清空依賴它的引用欄(表單層整欄、明細每一列),回清了什麼。比的是收斂後的值,所以計算欄位、
 * 被隱藏的欄位也算;清掉的引用欄若又被別欄引用,連鎖清下去。篩選值沒變(同一個 id)不清。
 * 編輯既有單據打開時不走這裡(只在改值的那一刻清)。
 */
export const clearLinkedReferences = (
  fields: readonly FieldDef[],
  links: readonly LinkedReference[],
  before: StoredValues,
  after: StoredValues,
  ctx: ExpressionContext,
): { values: StoredValues; cleared: ClearedLink[] } => {
  if (links.length === 0) {
    return { values: after, cleared: [] };
  }
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const referenced = [
    ...new Set(links.flatMap((link) => link.vars.map((v) => v.fieldKey))),
  ];
  const settledBefore = effectiveOf(fields, before, ctx);
  let values: StoredValues = after;
  const cleared: ClearedLink[] = [];
  for (let round = 0; round <= links.length; round += 1) {
    const settledAfter = effectiveOf(fields, values, ctx);
    const changed = new Set(
      referenced.filter(
        (key) =>
          filterVarValueOf(byKey.get(key), settledBefore[key]) !==
          filterVarValueOf(byKey.get(key), settledAfter[key]),
      ),
    );
    const next = clearDependents(links, values, changed);
    if (next.cleared.length === 0) {
      break;
    }
    values = next.values;
    cleared.push(...next.cleared);
  }
  return { values, cleared };
};
