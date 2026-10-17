import { useTranslations } from "use-intl";

import {
  type RetryAdvanceInstanceMutation,
  type WorkflowInstanceFieldsFragment,
  useRetryAdvanceInstanceMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

export interface RetryAdvanceButtonProps {
  instanceId: string;
  onDone: (instance: WorkflowInstanceFieldsFragment) => void;
}

/**
 * 重試推進(流程管理者;權限 `system.workflows.blocked-page.reassign`):冪等,重跑結果與正常路徑相同。
 * 詳情的審核區塊與阻擋清單共用。
 */
export const RetryAdvanceButton = ({
  instanceId,
  onDone,
}: RetryAdvanceButtonProps) => {
  const t = useTranslations("admin.approval.retry");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const retry = useRetryAdvanceInstanceMutation(
    session.client,
    useMutationFeedback<RetryAdvanceInstanceMutation>({
      success: t("success"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: (payload) => {
        onDone(payload.retryAdvanceInstance.instance);
      },
    }),
  );

  return (
    <Button
      size="small"
      variant="outlined"
      disabled={retry.isPending}
      onClick={() => {
        retry.mutate({ input: { instanceId } });
      }}
    >
      {t("button")}
    </Button>
  );
};
