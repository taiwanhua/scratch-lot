import { useTranslations } from "use-intl";

import { useDeleteWorkflowVersionDraftMutation } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";
import { useIsWorkflowDirty } from "@/stores/base/useWorkflowDraftStore";

export interface DeleteWorkflowDraftDialogProps {
  workflowKey: string;
  /** 版本面板讀到的草稿修訂號(樂觀鎖:別人先存過 → `CONFLICT`) */
  draftRevision: number;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * 刪除草稿的確認跳窗(`deleteWorkflowVersionDraft`):已發布 / 退役的版本不受影響,之後可再以任一版開新草稿。
 * 設計器還有未存的變更時一併提醒 —— 那些改動也會丟掉。
 */
export const DeleteWorkflowDraftDialog = ({
  workflowKey,
  draftRevision,
  onClose,
  onDeleted,
}: DeleteWorkflowDraftDialogProps) => {
  const t = useTranslations("admin.workflows.deleteDraft");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const isDirty = useIsWorkflowDirty(workflowKey);
  const remove = useDeleteWorkflowVersionDraftMutation(
    session.client,
    useMutationFeedback({
      success: t("success"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
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
                input: { workflowKey, expectedDraftRevision: draftRevision },
              });
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={1}>
        <Typography variant="body2">{t("body")}</Typography>
        {isDirty && (
          <Typography variant="body2" color="warning.main">
            {t("dirty")}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
};
