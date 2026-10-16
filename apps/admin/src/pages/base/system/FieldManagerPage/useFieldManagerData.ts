import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useFieldCategoriesQuery, useFieldsQuery } from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

import { FIELD_MANAGER_PERMISSIONS } from "./field-manager-permissions";
import type { FieldCategoryLike, FieldOptionLike } from "./field-manager-types";

/**
 * 欄位管理頁的資料層:類別清單、選中類別的合併清單、權限判斷與失效。
 *
 * 兩個查詢串起來(類別 → 該類別的選項),所以選中的類別 id 在還沒點過任何一列時
 * 取第一個類別(在 render 期間推導,不在 effect 內 setState,REACT-06)。
 *
 * 來源組織名稱與「這一列能不能按」由 api 逐列帶回來(#264),所以這裡不再讀 `me` ——
 * 合併清單含上層 / 下層組織加的選項,拿 session 的當前組織名去組字串會標錯來源。
 */
export const useFieldManagerData = () => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const canCreate = hasPermission(FIELD_MANAGER_PERMISSIONS.create);
  const canEdit = hasPermission(FIELD_MANAGER_PERMISSIONS.edit);
  const canToggleEnabled = hasPermission(
    FIELD_MANAGER_PERMISSIONS.toggleEnabled,
  );
  const canManageCategories = hasPermission(
    FIELD_MANAGER_PERMISSIONS.manageCategories,
  );

  const [pickedCategoryId, setPickedCategoryId] = useState<string | null>(null);

  const categoriesQuery = useFieldCategoriesQuery(session.client);
  const categories: readonly FieldCategoryLike[] =
    categoriesQuery.data?.fieldCategories.items ?? [];

  const firstCategoryId = categories.at(0)?.id ?? null;
  const selectedCategoryId = pickedCategoryId ?? firstCategoryId;
  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? null;

  const fieldsQuery = useFieldsQuery(
    session.client,
    { categoryId: selectedCategoryId ?? "" },
    { enabled: selectedCategoryId !== null },
  );
  const fields: readonly FieldOptionLike[] =
    fieldsQuery.data?.fields.items ?? [];

  /**
   * 選項寫入成功後精準失效(DATA-02 / 04):只有當前類別的選項清單會變,
   * `me` 也不受影響(欄位選項不進側欄)。
   */
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: useFieldsQuery.getKey({
        categoryId: selectedCategoryId ?? "",
      }),
    });
  };

  /**
   * 類別寫入(新增 / 改名 / 停用)後失效類別清單:以 `FieldCategories` 為前綴,
   * 本頁的全部清單與表單設計器的 `enabledOnly` 清單一起失效。選項清單不受影響。
   */
  const invalidateCategories = async () => {
    await queryClient.invalidateQueries({
      queryKey: useFieldCategoriesQuery.getKey(),
    });
  };

  return {
    canCreate,
    canEdit,
    canToggleEnabled,
    canManageCategories,
    categories,
    isCategoriesLoading: categoriesQuery.isLoading,
    selectedCategoryId,
    selectedCategory,
    selectCategory: setPickedCategoryId,
    fields,
    isFieldsLoading: fieldsQuery.isLoading,
    invalidate,
    invalidateCategories,
  };
};
