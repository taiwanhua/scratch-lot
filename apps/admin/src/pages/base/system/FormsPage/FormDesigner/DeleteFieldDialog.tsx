import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { FieldReference } from "@/lib/base/form-engine/field-references";

import { FieldReferenceList } from "./FieldReferenceList";

export interface DeleteFieldDialogProps {
  field: FieldDef;
  references: readonly FieldReference[];
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 刪除欄位的確認:先列出引用它的表達式、摘要槽、帶入規則(草稿內),
 * 以及列表欄位配置(草稿外,只提示)。確認後**只從草稿的欄位與版面移除**,引用處變成檢查器錯誤,
 * 由設計者手動修 —— 不自動改公式、不自動清引用。
 */
export const DeleteFieldDialog = ({
  field,
  references,
  onCancel,
  onConfirm,
}: DeleteFieldDialogProps) => {
  const t = useTranslations("admin.forms.deleteField");

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
      title={t("title", { label: field.label })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button color="error" onClick={onConfirm}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <Typography variant="body2">{t("body")}</Typography>
        <FieldReferenceList references={references} />
      </Stack>
    </Dialog>
  );
};
