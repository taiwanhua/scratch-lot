import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { OrgTreePicker } from "@/components/base/OrgTreePicker/OrgTreePicker";
import type { OrgNodeLike } from "@/lib/base/org-tree";

export interface OrgPickerDialogProps {
  title: string;
  nodes: readonly OrgNodeLike[];
  isLoading?: boolean;
  /** 開啟時的既有所屬組織;元件內部自己記變動,確定才回報 */
  initialSelectedIds: readonly string[];
  /**
   * 勾選框鎖住的組織:擁有者不可被移出自己擁有的租戶頂層,
   * 那一個節點維持勾選、取消不掉;其餘組織照常可勾可取消。空陣列 = 沒有鎖。
   */
  lockedOrgIds?: readonly string[];
  /** 有鎖住的節點時顯示的原因(沒有鎖就不顯示) */
  lockedHint?: string;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (orgIds: string[]) => void;
}

/**
 * 選擇所屬組織(Figma 92:222):樹勾選,範圍外節點灰掉不可選(`outOfScope`);
 * `lockedOrgIds` 的節點維持勾選、取消不掉(擁有者的租戶頂層)。
 * 只負責「勾了哪些」— 移除時的 dry-run 與三檔由呼叫端接著處理(`OrgChangeDialog`)。
 * 呼叫端在關閉時卸載本元件,重開即是新的一輪(初始值由 props 帶入,不需 effect 同步)。
 */
export const OrgPickerDialog = ({
  title,
  nodes,
  isLoading = false,
  initialSelectedIds,
  lockedOrgIds = [],
  lockedHint,
  isSubmitting = false,
  onCancel,
  onConfirm,
}: OrgPickerDialogProps) => {
  const t = useTranslations("admin.userManager.orgPicker");
  const tTree = useTranslations("admin.userManager.orgTree");
  const [selectedIds, setSelectedIds] =
    useState<readonly string[]>(initialSelectedIds);
  const [keyword, setKeyword] = useState("");

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={title}
      actions={
        <>
          <Typography
            variant="subtitle2"
            color="text.secondary"
            sx={{ flex: 1 }}
          >
            {t("selected", { count: selectedIds.length })}
          </Typography>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            disabled={selectedIds.length === 0 || isSubmitting}
            onClick={() => {
              onConfirm([...selectedIds]);
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <TextField
          label={tTree("search")}
          size="small"
          fullWidth
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
          }}
        />
        <OrgTreePicker
          nodes={nodes}
          isLoading={isLoading}
          isMultiSelect
          keyword={keyword}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          lockedIds={lockedOrgIds}
          maxHeight={320}
          aria-label={title}
        />
        {/* 鎖住的節點自己沒有文字說明(勾選框 disabled 收不到 hover),原因寫在樹下方 */}
        {lockedOrgIds.length > 0 && lockedHint !== undefined && (
          <Typography variant="caption" color="text.secondary">
            {lockedHint}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {t("hint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
