/**
 * 表單設定「依欄位共用」(`sharedByFieldKeys`):這張表單的提交**也給這幾個組織欄位指到的組織看**
 * (ADR-0014 的 `sharedByFields`)。引擎每次寫入存值時,從這幾欄算出提交頂層的 `sharedOrgIds`;
 * 讀取由 `form_submissions` 的資料共用宣告放寬,寫入不放大(對方只能看)。
 *
 * 欄位要是**表單層**(不在明細列內)、引用組織(`type: "reference"`、`source.provider = "org"`)的欄位。
 */
import type { FieldDef } from "./types";

/** 組織引用欄的 lookup 來源 key(`apps/api/src/forms/lookup-providers.ts`)。 */
export const ORG_REFERENCE_PROVIDER = "org";

/** 這一欄可不可以當「依欄位共用」的欄位:表單層的組織引用欄。 */
export function isOrgReferenceField(field: FieldDef): boolean {
  return (
    field.type === "reference" &&
    field.source?.provider === ORG_REFERENCE_PROVIDER
  );
}

/** 「依欄位共用」設定的一個問題:`key` = 哪一個設定值,`reason` = 不存在 / 不是組織引用欄 / 重複。 */
export interface SharedByFieldIssue {
  key: string;
  reason: "notFound" | "notOrgReference" | "duplicate";
}

/** 對照一版的欄位檢查設定值;全部合格回空陣列。 */
export function sharedByFieldIssues(
  fields: readonly FieldDef[],
  keys: readonly string[],
): SharedByFieldIssue[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const seen = new Set<string>();
  const issues: SharedByFieldIssue[] = [];
  for (const key of keys) {
    if (seen.has(key)) {
      issues.push({ key, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    const field = byKey.get(key);
    if (field === undefined) {
      issues.push({ key, reason: "notFound" });
    } else if (!isOrgReferenceField(field)) {
      issues.push({ key, reason: "notOrgReference" });
    }
  }
  return issues;
}

/**
 * 從存值算出「也給哪些組織看」:每個設定的欄位取引用的組織 id(`{ id, label }` 的 `id`),
 * 沒值 / 形狀不對的略過,去重、照設定順序。回組織 id 字串(api 轉成 ObjectId 存)。
 */
export function sharedOrgIdsOf(
  keys: readonly string[],
  values: Readonly<Record<string, unknown>>,
): string[] {
  const ids: string[] = [];
  for (const key of keys) {
    const cell = values[key];
    const id =
      typeof cell === "object" && cell !== null && "id" in cell
        ? cell.id
        : null;
    if (typeof id === "string" && id !== "" && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}
