import { semanticValueOf } from "./semantic";
import type { FieldDef, FieldType, LookupSourceDescriptor } from "./types";

/**
 * 連動篩選(《底座規格》3.2 B2d):lookup 來源 `filter` 的值可以引用**表單層**欄位 `{ "var": "<欄位 key>" }`
 * (例 `filter: { orgId: { var: "ship_org" } }`)。執行時換成那一欄目前的值再當等值條件:
 *
 * - 前端查 `formLookup` 時一併送引用欄位目前的值(`filterValues`);api 只把它當成**縮小範圍**的條件,
 *   仍在操作者可見範圍內
 * - 送出時 api 用最後存下的值再驗一次:引用的資料不符 → `LOOKUP_FILTER_MISMATCH`
 * - 被引用的欄位沒有值 → 這個來源查無(前端停用依賴它的引用欄);引用欄位改值 → 前端清空依賴它的引用欄
 *
 * 只有引用欄位(表單層引用欄、明細引用子欄)能用;明細子欄只能引用表單層欄位,不能引用同一列的其他子欄。
 */

/** 篩選值引用的一個欄位。 */
export interface LookupFilterVar {
  /** provider 的篩選欄位(`filter` 的鍵) */
  filterField: string;
  /** 被引用的表單層欄位 key */
  fieldKey: string;
}

/** 連動篩選的值:字串 / 數字 / 是否(等值比對);沒有值為 null。 */
export type LookupFilterScalar = string | number | boolean;

/** 能被連動篩選引用的欄位型別(值是單一純量)。 */
export const FILTER_VAR_FIELD_TYPES: readonly FieldType[] = [
  "text",
  "number",
  "boolean",
  "select",
  "reference",
];

/** `filter` 的值是不是 `{ var: ... }`(形狀不對的也算,交給檢查器報錯)。 */
export function isLookupFilterVar(value: unknown): value is { var: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "var")
  );
}

/** 來源描述的連動篩選(`filter` 裡值是 `{ var: "<key>" }` 的鍵);沒有就是空陣列。 */
export function lookupFilterVarsOf(
  source: LookupSourceDescriptor | null | undefined,
): LookupFilterVar[] {
  const vars: LookupFilterVar[] = [];
  for (const [filterField, value] of Object.entries(source?.filter ?? {})) {
    if (isLookupFilterVar(value) && typeof value.var === "string") {
      vars.push({ filterField, fieldKey: value.var });
    }
  }
  return vars;
}

/** 來源描述有沒有連動篩選(含形狀不對的 `{ var }`)。 */
export function hasLookupFilterVars(
  source: LookupSourceDescriptor | null | undefined,
): boolean {
  return Object.values(source?.filter ?? {}).some((value) =>
    isLookupFilterVar(value),
  );
}

/**
 * 一欄的存值 → 連動篩選用的值(語意值,`semanticValueOf`):單選給 value、引用給 id、數字給數字;
 * 空字串、空值、非純量 → null(= 沒填)。
 */
export function filterVarValueOf(
  field: Pick<FieldDef, "type" | "columns"> | undefined,
  stored: unknown,
): LookupFilterScalar | null {
  if (field === undefined) {
    return null;
  }
  const semantic = semanticValueOf(field as FieldDef, stored);
  // 數字欄在前端存十進位字串:換成數字再比
  const candidate =
    field.type === "number" &&
    typeof semantic === "string" &&
    semantic.trim() !== ""
      ? Number(semantic)
      : semantic;
  return filterScalarOf(candidate);
}

/** 傳進來的值(前端送的 `filterValues`)只收純量;空字串、非有限數字、其他一律當沒填。 */
export function filterScalarOf(value: unknown): LookupFilterScalar | null {
  const isScalar =
    (typeof value === "string" && value !== "") ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean";
  return isScalar ? value : null;
}

/** 欄位型別 → 篩選值的 JS 型別(沒列的是字串)。 */
const SCALAR_TYPE_OF: Partial<Record<FieldType, "boolean" | "number">> = {
  boolean: "boolean",
  number: "number",
};

/**
 * 前端送來的篩選值依**被引用欄位的型別**收:是否欄只收 true / false、數字欄只收數字、其餘(文字 / 單選 / 引用)
 * 只收字串;型別不符或欄位不存在 → null(= 沒填,這個來源查無)。避免竄改的值型別撞上文件欄位(例 CastError)。
 */
export function filterScalarForField(
  field: Pick<FieldDef, "type"> | undefined,
  value: unknown,
): LookupFilterScalar | null {
  const scalar = filterScalarOf(value);
  const expected =
    field === undefined ? null : (SCALAR_TYPE_OF[field.type] ?? "string");
  return typeof scalar === expected ? scalar : null;
}

/**
 * 把連動篩選換成目前的值:`valueOf(fieldKey)` 回那一欄的篩選值。
 * 任一被引用欄位沒有值(或 `{ var }` 形狀不對)→ `null`(這個來源此刻查無);沒有連動篩選照原樣回。
 */
export function resolveLookupSource(
  source: LookupSourceDescriptor,
  valueOf: (fieldKey: string) => LookupFilterScalar | null,
): LookupSourceDescriptor | null {
  if (!hasLookupFilterVars(source)) {
    return source;
  }
  const filter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source.filter ?? {})) {
    if (!isLookupFilterVar(value)) {
      filter[key] = value;
      continue;
    }
    const resolved = typeof value.var === "string" ? valueOf(value.var) : null;
    if (resolved === null) {
      return null;
    }
    filter[key] = resolved;
  }
  return { ...source, filter };
}

/** 拿掉連動篩選、只留固定條件的來源描述(送出時區分「讀不到」與「不符篩選」用)。 */
export function withoutLookupFilterVars(
  source: LookupSourceDescriptor,
): LookupSourceDescriptor {
  if (!hasLookupFilterVars(source)) {
    return source;
  }
  const filter = Object.fromEntries(
    Object.entries(source.filter ?? {}).filter(
      ([, value]) => !isLookupFilterVar(value),
    ),
  );
  return { ...source, filter };
}

/**
 * 篩選欄位與被引用欄位的型別相符:同型別;篩選欄位是文字時也收單選(value)與引用(id)。
 * 篩選欄位的型別不明(專案宣告的篩選欄位不在可回欄位內)→ 不擋。
 */
export function isFilterVarCompatible(
  filterType: FieldType | null | undefined,
  fieldType: FieldType,
): boolean {
  if (!FILTER_VAR_FIELD_TYPES.includes(fieldType)) {
    return false;
  }
  if (filterType === null || filterType === undefined) {
    return true;
  }
  return (
    filterType === fieldType ||
    (filterType === "text" &&
      (fieldType === "select" || fieldType === "reference"))
  );
}
