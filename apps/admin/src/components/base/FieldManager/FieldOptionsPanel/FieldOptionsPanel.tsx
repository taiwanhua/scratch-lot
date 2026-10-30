import { useTranslations } from "use-intl";

import type { TagPaletteKey } from "@repo/domain/tag-palette";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type {
  FieldCategoryLike,
  FieldOptionLike,
} from "../field-manager-types";
import { FieldOptionsTable } from "./FieldOptionsTable";

export interface FieldOptionsPanelProps {
  category: FieldCategoryLike | null;
  fields: readonly FieldOptionLike[];
  isLoading: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canToggleEnabled: boolean;
  /** 持 `category-ops.manage-categories`:標題列多出「編輯類別」與停用 / 啟用類別 */
  canManageCategories: boolean;
  isCategoryPending: boolean;
  pendingFieldId: string | null;
  onEditCategory: () => void;
  onToggleCategory: (enabled: boolean) => void;
  onCreate: () => void;
  onEdit: (field: FieldOptionLike) => void;
  onToggleEnabled: (field: FieldOptionLike, enabled: boolean) => void;
  onSetColor: (field: FieldOptionLike, color: TagPaletteKey | null) => void;
}

/**
 * 右欄選項區(Figma Options 90:227):標題「<類別名> — 選項」+「新增自訂選項」+ 表格。
 * 新增鈕依 `system.field-manager.create` 出現與否(ADR-0011:沒有權限的動作不顯示)。
 * 類別作業(`manage-categories`)的按鈕也在這一列:系統類別唯讀,沒有「編輯類別」與「停用類別」,
 * 停用的類別可再啟用;停用不另開確認 —— 可逆,且只影響表單設計器的類別清單。
 */
export const FieldOptionsPanel = ({
  category,
  fields,
  isLoading,
  canCreate,
  canEdit,
  canToggleEnabled,
  canManageCategories,
  isCategoryPending,
  pendingFieldId,
  onEditCategory,
  onToggleCategory,
  onCreate,
  onEdit,
  onToggleEnabled,
  onSetColor,
}: FieldOptionsPanelProps) => {
  const t = useTranslations("admin.fieldManager.options");
  const tCategory = useTranslations("admin.fieldManager.categoryActions");
  const canToggleCategory =
    category !== null && (!category.isSystem || !category.enabled);

  return (
    <Card
      component="section"
      aria-label={t("region")}
      // 欄型 flex:標題列固定、選項表吃掉剩下的高度並自己捲,
      // 面板不再整塊捲,橫向捲軸才落在面板底部而不是最後一列下方
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        p: 3,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", pb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0 }}>
          {category === null
            ? t("noCategory")
            : t("title", { category: category.name })}
        </Typography>
        {canManageCategories && category !== null && !category.isSystem && (
          <Button variant="text" size="small" onClick={onEditCategory}>
            {tCategory("edit")}
          </Button>
        )}
        {canManageCategories && canToggleCategory && (
          <Button
            variant="text"
            size="small"
            disabled={isCategoryPending}
            onClick={() => {
              onToggleCategory(!category.enabled);
            }}
          >
            {category.enabled ? tCategory("disable") : tCategory("enable")}
          </Button>
        )}
        {canCreate && category !== null && (
          <Button size="small" onClick={onCreate}>
            {t("create")}
          </Button>
        )}
      </Stack>

      {category === null ? (
        <Typography variant="body2" color="textSecondary">
          {t("noCategoryHint")}
        </Typography>
      ) : (
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <FieldOptionsTable
            fields={fields}
            isLoading={isLoading}
            canEdit={canEdit}
            canToggleEnabled={canToggleEnabled}
            pendingFieldId={pendingFieldId}
            onToggleEnabled={onToggleEnabled}
            onEdit={onEdit}
            onSetColor={onSetColor}
          />
        </Box>
      )}
    </Card>
  );
};
