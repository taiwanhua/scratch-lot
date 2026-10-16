import { useFieldCategoriesQuery, useFieldsQuery } from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

import {
  DEMO_CATEGORY_KEY,
  FIELD_MANAGER_VIEW_PERMISSION,
} from "./demo-sample-one-config";
import type { DemoCategoryOption } from "./demo-sample-one-types";

export interface DemoCategoryOptions {
  /**
   * 選項拿不拿得到。`fieldCategories` / `fields` 都掛在 `system.field-manager.view` 底下
   * (api 正本 `fields.resolver.ts`),所以只有示範模組權限、沒有欄位管理檢視權限的人
   * 拿不到選項 —— 列表不顯示分類篩選、表單的分類欄退成唯讀(改不動但看得到原值)。
   */
  isAvailable: boolean;
  /** 可選的選項(**停用的不列**:停用只影響新填寫,既有資料照樣顯示原本的 `categoryLabel`) */
  options: readonly DemoCategoryOption[];
  isLoading: boolean;
}

/**
 * 分類下拉的選項(欄位管理的「示範分類」;`docs/modules/field-manager.md`「api 介面」)。
 * 列表的篩選與表單的下拉共用同一份 —— 兩邊看到的選項必須一樣。
 *
 * 兩段接力:先查類別(找 key 是 `demo-category` 的那一個),再查它的合併清單。
 * 類別 id 在還沒回來前不送第二個查詢(`enabled`),不要送空字串進 api。
 */
export const useDemoCategoryOptions = (): DemoCategoryOptions => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const isAvailable = hasPermission(FIELD_MANAGER_VIEW_PERMISSION);

  const categories = useFieldCategoriesQuery(session.client, undefined, {
    enabled: isAvailable,
  });
  const categoryId =
    categories.data?.fieldCategories.items.find(
      (category) => category.key === DEMO_CATEGORY_KEY,
    )?.id ?? null;

  const fields = useFieldsQuery(
    session.client,
    { categoryId: categoryId ?? "" },
    { enabled: isAvailable && categoryId !== null },
  );

  const options: readonly DemoCategoryOption[] = (
    fields.data?.fields.items ?? []
  )
    .filter((field) => field.enabled)
    .map((field) => ({ value: field.value, label: field.label }));

  // 「還在路上」= 類別還沒回來,或類別回來了、它的選項還在查
  const isLoading =
    isAvailable &&
    (categories.isLoading || (categoryId !== null && fields.isLoading));

  return { isAvailable, options, isLoading };
};
