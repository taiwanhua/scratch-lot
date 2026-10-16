import { useTranslations } from "use-intl";

import { useRetireCurrentWorkflowVersionMutation } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

export interface RetireWorkflowDialogProps {
  workflowKey: string;
  onClose: () => void;
  onRetired: () => void;
}

/**
 * 退役目前版本:`currentVersion → null`,之後綁這個流程的表單**送出會被擋**(「流程尚未發布」),
 * 直到再發布新版;進行中的審核照常走完(實例記自己的流程版本)。
 */
export const RetireWorkflowDialog = ({
  workflowKey,
  onClose,
  onRetired,
}: RetireWorkflowDialogProps) => {
  const t = useTranslations("admin.workflows.retire");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const retire = useRetireCurrentWorkflowVersionMutation(
    session.client,
    useMutationFeedback({
      success: t("success"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: onRetired,
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
            disabled={retire.isPending}
            onClick={() => {
              retire.mutate({ input: { workflowKey } });
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
