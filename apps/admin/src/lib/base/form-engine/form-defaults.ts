import {
  type ExpressionContext,
  type FieldDef,
  type StoredValues,
  defaultOrder,
  defaultValueOf,
  referencedFieldKeys,
} from "@repo/domain/form";

import type { FieldPermissionFacts } from "./field-states";

/**
 * 填寫時的預設值(Spec 6a §5「預設值」;計算本體是 `@repo/domain/form` 的 `defaultValueOf`):
 *
 * - 新增頁一打開就依預設值填好(建草稿時 api 也會算一次,只填空欄,結果一致)
 * - 使用者**沒碰過**的欄位,依賴的欄位變了就跟著重算;碰過(改過、清空、帶入)就停,之後照使用者的值送出
 * - 讀不到(公式引用的欄位沒有 show)或改不動(沒有欄位級 edit)的欄位不填 —— 與 api 同一條
 *
 * 引用欄的預設值(填寫者 / 填寫者的組織)只有 id;畫面上先用登入者的名稱 / 當前組織名稱當 label,
 * 送出時 api 重取 label 寫快照。
 */

export interface DefaultFillInput {
  fields: readonly FieldDef[];
  values: StoredValues;
  ctx: ExpressionContext;
  touched: ReadonlySet<string>;
  permissions: FieldPermissionFacts;
  /** 系統值的顯示名(引用欄預設值的暫時 label):`ctx.user.id` → 登入者名稱、`ctx.user.orgId` → 當前組織名稱 */
  systemLabels?: { user: string | null; org: string | null };
}

const labelOf = (
  value: unknown,
  ctx: ExpressionContext,
  labels: DefaultFillInput["systemLabels"],
): unknown => {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    return value;
  }
  const { id } = value;
  let label: string | null = null;
  if (id === ctx.user.id) {
    label = labels?.user ?? null;
  } else if (id === ctx.user.orgId) {
    label = labels?.org ?? null;
  }
  return { id, label };
};

/** 以目前的值重算沒碰過的欄位的預設值,回新的值(不改傳入的物件)。 */
export const withDefaults = ({
  fields,
  values,
  ctx,
  touched,
  permissions,
  systemLabels,
}: DefaultFillInput): StoredValues => {
  const next: StoredValues = { ...values };
  for (const field of defaultOrder(fields)) {
    const refs =
      field.default?.kind === "expression"
        ? referencedFieldKeys(field.default.expr)
        : [];
    if (
      touched.has(field.key) ||
      !permissions.canEdit(field.key) ||
      refs.some((key) => !permissions.canShow(key))
    ) {
      continue;
    }
    const value = defaultValueOf(field, fields, next, ctx) ?? null;
    next[field.key] =
      field.type === "reference" ? labelOf(value, ctx, systemLabels) : value;
  }
  return next;
};

/** 兩份值之間改了哪些欄位(`FormRenderer` 一次只改一欄;帶入可能一次改好幾欄)。 */
export const changedKeysOf = (
  before: StoredValues,
  after: StoredValues,
): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => before[key] !== after[key],
  );
