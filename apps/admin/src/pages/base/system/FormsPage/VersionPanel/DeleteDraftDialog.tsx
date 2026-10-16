import { useTranslations } from "use-intl";

import { useDeleteFormVersionDraftMutation } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

export interface DeleteDraftDialogProps {
  formKey: string;
  /** 刪的是讀到的那一份草稿(樂觀鎖;別人剛存過 → CONFLICT) */
  draftRevision: number;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * 刪除表單草稿(`deleteFormVersionDraft`):草稿與設計器裡還沒存的變更都丟掉;已發布的版本不受影響,
 * 之後可再以任一版本為基底開新草稿。發布中(或發布中斷)時 api 擋下。
 */
export const DeleteDraftDialog = ({
  formKey,
  draftRevision,
  onClose,
  onDeleted,
}: DeleteDraftDialogProps) => {
  const t = useTranslations("admin.forms.deleteDraft");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const remove = useDeleteFormVersionDraftMutation(
    session.client,
    useMutationFeedback({
      success: t("success"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onDeleted,
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate({
                input: { formKey, expectedDraftRevision: draftRevision },
              });
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Typography variant="body2">{t("body")}</Typography>
    </Dialog>
  );
};
