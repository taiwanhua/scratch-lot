import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type SetFieldCategoryEnabledMutation,
  type SetFieldEnabledMutation,
  useSetFieldCategoryEnabledMutation,
  useSetFieldEnabledMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  editAbilityOf,
  useUrlEdit,
  useUrlEditGuard,
} from "@/hooks/base/useUrlEdit";

import { CategoryFormDialog } from "./CategoryFormDialog/CategoryFormDialog";
import { CategoryListPanel } from "./CategoryListPanel";
import { FieldFormDialog } from "./FieldFormDialog/FieldFormDialog";
import { FieldOptionsPanel } from "./FieldOptionsPanel/FieldOptionsPanel";
import { fieldManagerErrorOf } from "./field-manager-error";
import type {
  FieldManagerErrorCode,
  FieldOptionLike,
} from "./field-manager-types";
import { canEditOption } from "./field-source";
import { useFieldManagerData } from "./useFieldManagerData";

/**
 * 欄位管理(模組 key `system.field-manager`,正本 `docs/modules/field-manager.md`;
 * Figma「Screen / Admin 欄位管理」90:2、新增選項 211:176)。
 *
 * 左欄是欄位類別(系統類別 + root 在本頁新增的;新增 / 改名 / 停用限 `manage-categories`),
 * 右欄是所選類別的**合併清單** = 全域種子 + 上層組織自訂
 * + 本組織自訂 + 可見範圍內的下層自訂(規則表正本見上述模組文件)。
 * 一列能做什麼由 api 逐列算好(`canEdit` / `canToggleEnabled`),前端只跟權限取交集;
 * 自訂選項可改 label / order / description,但 `value` 建立後不可改;選項一律不刪、只停用。
 * 解讀集中在 `field-source.ts`,表格與彈窗不自己推組織關係。
 */
export const FieldManagerPage = () => {
  const { session } = useSession();
  const t = useTranslations("admin.fieldManager");
  const data = useFieldManagerData();

  /**
   * 編輯選項的彈窗記在網址 `?edit=<選項 id>`(REACT-14):以 id 從選中類別的選項清單(伺服器最新的那一份)取那一筆;
   * 不在清單裡 → 提示找不到,沒有編輯權限(含別的組織加的選項)→ 清掉參數。
   */
  const edit = useUrlEdit();
  const editTarget =
    data.fields.find((field) => field.id === edit.requestedId) ?? null;
  const editingId = useUrlEditGuard({
    edit,
    canEdit: editAbilityOf(
      data.canEdit,
      editTarget === null
        ? undefined
        : canEditOption(editTarget, { canEdit: data.canEdit }),
    ),
    isMissing:
      edit.requestedId !== null && data.isFieldsReady && editTarget === null,
  });
  const editing = editingId === null ? null : editTarget;
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<FieldManagerErrorCode | null>(
    null,
  );
  const [pendingFieldId, setPendingFieldId] = useState<string | null>(null);
  /** 類別彈窗:`"create"` = 新增;`"edit"` = 編輯目前選中的類別 */
  const [categoryDialog, setCategoryDialog] = useState<
    "create" | "edit" | null
  >(null);

  const setFieldEnabled = useSetFieldEnabledMutation(
    session.client,
    useMutationFeedback<SetFieldEnabledMutation>({
      success: (payload) =>
        payload.setFieldEnabled.field.enabled
          ? t("feedback.enableSuccess")
          : t("feedback.disableSuccess"),
      // 失敗的 Snackbar 文案與頁面上那一條 Alert 同一份解讀
      error: (error) => t(`errors.${fieldManagerErrorOf(error).code}`),
      onSuccess: () => {
        setPendingFieldId(null);
        setActionError(null);
        void data.invalidate();
      },
      onError: (error: unknown) => {
        setPendingFieldId(null);
        setActionError(fieldManagerErrorOf(error).code);
      },
    }),
  );

  const setCategoryEnabled = useSetFieldCategoryEnabledMutation(
    session.client,
    useMutationFeedback<SetFieldCategoryEnabledMutation>({
      success: (payload) =>
        payload.setFieldCategoryEnabled.category.enabled
          ? t("feedback.categoryEnableSuccess")
          : t("feedback.categoryDisableSuccess"),
      error: (error) => t(`errors.${fieldManagerErrorOf(error).code}`),
      onSuccess: () => {
        setActionError(null);
        void data.invalidateCategories();
      },
      onError: (error: unknown) => {
        setActionError(fieldManagerErrorOf(error).code);
      },
    }),
  );

  /** 停用 / 啟用不另開確認彈窗:可逆,且既有資料不受影響(只影響新填寫)。 */
  const handleToggleEnabled = (field: FieldOptionLike, enabled: boolean) => {
    setActionError(null);
    setPendingFieldId(field.id);
    setFieldEnabled.mutate({ input: { id: field.id, enabled } });
  };

  const closeDialog = () => {
    setIsCreateOpen(false);
    edit.close();
  };

  const handleSaved = () => {
    closeDialog();
    setActionError(null);
    void data.invalidate();
  };

  const handleCategorySaved = () => {
    setCategoryDialog(null);
    setActionError(null);
    void data.invalidateCategories();
  };

  const isDialogOpen = isCreateOpen || editing !== null;

  return (
    // 撐滿殼給的內容區高度(STYLE-08 / Figma 90:214:左右兩塊等高、各自內部捲動)
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      {actionError !== null && (
        <Alert severity="error">{t(`errors.${actionError}`)}</Alert>
      )}

      <Stack direction="row" spacing={3} sx={{ flex: 1, minHeight: 0 }}>
        <CategoryListPanel
          categories={data.categories}
          isLoading={data.isCategoriesLoading}
          selectedCategoryId={data.selectedCategoryId}
          canManageCategories={data.canManageCategories}
          onSelectCategory={data.selectCategory}
          onCreateCategory={() => {
            setActionError(null);
            setCategoryDialog("create");
          }}
        />
        <FieldOptionsPanel
          category={data.selectedCategory}
          fields={data.fields}
          isLoading={data.isFieldsLoading}
          canCreate={data.canCreate}
          canEdit={data.canEdit}
          canToggleEnabled={data.canToggleEnabled}
          canManageCategories={data.canManageCategories}
          isCategoryPending={setCategoryEnabled.isPending}
          pendingFieldId={pendingFieldId}
          onEditCategory={() => {
            setActionError(null);
            setCategoryDialog("edit");
          }}
          onToggleCategory={(enabled) => {
            if (data.selectedCategory === null) {
              return;
            }
            setActionError(null);
            setCategoryEnabled.mutate({
              input: { id: data.selectedCategory.id, enabled },
            });
          }}
          onCreate={() => {
            setActionError(null);
            setIsCreateOpen(true);
          }}
          onEdit={(field) => {
            setActionError(null);
            edit.open(field.id);
          }}
          onToggleEnabled={handleToggleEnabled}
        />
      </Stack>

      {isDialogOpen && data.selectedCategory !== null && (
        <FieldFormDialog
          key={editing?.id ?? "create"}
          categoryId={data.selectedCategory.id}
          categoryName={data.selectedCategory.name}
          {...(editing === null ? {} : { field: editing })}
          onClose={closeDialog}
          onSaved={handleSaved}
        />
      )}

      {categoryDialog !== null && (
        <CategoryFormDialog
          categories={data.categories}
          {...(categoryDialog === "edit" && data.selectedCategory !== null
            ? { category: data.selectedCategory }
            : {})}
          onClose={() => {
            setCategoryDialog(null);
          }}
          onSaved={handleCategorySaved}
        />
      )}
    </Stack>
  );
};
