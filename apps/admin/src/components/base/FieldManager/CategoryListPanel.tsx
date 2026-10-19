import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { FieldCategoryLike } from "./field-manager-types";

export interface CategoryListPanelProps {
  categories: readonly FieldCategoryLike[];
  isLoading: boolean;
  selectedCategoryId: string | null;
  /** 持 `category-ops.manage-categories` 才顯示「新增類別」 */
  canManageCategories: boolean;
  onSelectCategory: (categoryId: string) => void;
  onCreateCategory: () => void;
}

/**
 * 左欄欄位類別(Figma Categories 90:215):名稱 + 類別 key。
 *
 * 類別兩種來源:seed 宣告的**系統類別**(標「系統」,不可停用)與 root 在本頁新增的類別。
 * 新增 / 改名 / 停用是根組織專屬(`manage-categories`,ADR-0011:沒有權限的動作不顯示);
 * 停用的類別照樣列出但灰掉、標「已停用」—— 它只從表單設計器的類別清單消失,既有欄位照常顯示。
 */
export const CategoryListPanel = ({
  categories,
  isLoading,
  selectedCategoryId,
  canManageCategories,
  onSelectCategory,
  onCreateCategory,
}: CategoryListPanelProps) => {
  const t = useTranslations("admin.fieldManager.categories");

  return (
    <Card
      component="section"
      aria-label={t("title")}
      sx={{
        p: 2,
        width: 300,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Stack spacing={0.25} sx={{ flex: 1, minHeight: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0 }}>
            {t("title")}
          </Typography>
          {canManageCategories && (
            <Button size="small" onClick={onCreateCategory}>
              {t("create")}
            </Button>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {canManageCategories ? t("manageNotice") : t("seedNotice")}
        </Typography>
        {/* 清單佔滿標題列以外的高度,超出時自己捲(STYLE-08) */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", pt: 1 }}>
          {isLoading ? (
            <Stack sx={{ alignItems: "center", py: 3 }}>
              <CircularProgress aria-label={t("loading")} />
            </Stack>
          ) : (
            <List disablePadding>
              {categories.map((category) => (
                <ListItemButton
                  key={category.id}
                  selected={category.id === selectedCategoryId}
                  sx={{ borderRadius: 1, gap: 1 }}
                  onClick={() => {
                    onSelectCategory(category.id);
                  }}
                >
                  <ListItemText
                    primary={category.name}
                    secondary={category.key}
                    slotProps={{
                      primary: {
                        variant: "subtitle2",
                        ...(category.enabled ? {} : { color: "text.disabled" }),
                      },
                      secondary: { variant: "caption" },
                    }}
                  />
                  <Stack direction="row" spacing={0.5}>
                    {category.isSystem && <Tag label={t("systemTag")} />}
                    {!category.enabled && (
                      <Tag tone="warning" label={t("disabledTag")} />
                    )}
                  </Stack>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </Stack>
    </Card>
  );
};
