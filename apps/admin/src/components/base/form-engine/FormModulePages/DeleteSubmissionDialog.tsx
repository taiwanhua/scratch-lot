import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { FormErrorCode } from "@/lib/base/form-engine/form-errors";

export interface DeleteSubmissionDialogProps {
  label: string;
  isSubmitting: boolean;
  errorCode: FormErrorCode | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 刪除一筆提交的確認(列表與詳情共用;草稿 = 建立者本人、已完成 = 模組 `delete`,由 api 的 `abilities` 決定出不出現)。 */
export const DeleteSubmissionDialog = ({
  label,
  isSubmitting,
  errorCode,
  onCancel,
  onConfirm,
}: DeleteSubmissionDialogProps) => {
  const t = useTranslations("admin.formEngine.pages");
  const tErrors = useTranslations("admin.formEngine.errors");

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("deleteTitle")}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button color="error" disabled={isSubmitting} onClick={onConfirm}>
            {t("deleteConfirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2">{t("deleteBody", { label })}</Typography>
        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
