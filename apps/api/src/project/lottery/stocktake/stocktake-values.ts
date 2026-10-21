import type { StoredValues } from "@repo/domain/form";
import {
  STOCKTAKE_FIELD_KEYS,
  type StocktakeDraft,
  parseStocktakeDraft,
} from "@repo/domain/project/lottery";

/** 表單的 reference 值 → id 文字(存成 id 字串或 `{ value | id }`)。 */
function referenceIdOf(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const id = record.value ?? record.id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** 盤點確認申請的值 → 盤點內容;讀不懂 / 「分店」與盤點內容的分店對不上 → null。 */
export function draftOfValues(values: StoredValues): StocktakeDraft | null {
  const parsed = parseStocktakeDraft(values[STOCKTAKE_FIELD_KEYS.draft]);
  if (!parsed.ok) {
    return null;
  }
  const branch = referenceIdOf(values[STOCKTAKE_FIELD_KEYS.branch]);
  return branch === parsed.draft.orgId ? parsed.draft : null;
}
