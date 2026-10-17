import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  BlockedInstancesFilter,
  useAddStepAssigneeMutation,
  useBlockedInstancesQuery,
  useReassignTaskMutation,
  useWorkflowInstanceQuery,
} from "@repo/graphql";

import { useInvalidateApplyCenterCounts } from "@/hooks/base/useApplyCenterCounts";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

/**
 * 阻擋清單的處置(權限 `system.workflows.blocked-page.reassign`):改派、新增審核者。
 * 成功後清單、該實例與申請中心的 badge 數字都重查(推進可能已解除阻擋、實例換了狀態、任務換了承辦人);
 * 失敗的文案在跳窗裡就地顯示。
 */
export const useBlockedActions = () => {
  const t = useTranslations("admin.workflows.blocked");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const invalidateCounts = useInvalidateApplyCenterCounts();
  const showSnackbar = useSnackbar();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reassign = useReassignTaskMutation(session.client);
  const add = useAddStepAssigneeMutation(session.client);

  const refresh = (instanceId: string) => {
    void queryClient.invalidateQueries({
      // 兩種篩選、各頁一起失效:取 key 的第一段當前綴
      queryKey: useBlockedInstancesQuery
        .getKey({ input: { filter: BlockedInstancesFilter.Blocked } })
        .slice(0, 1),
    });
    void queryClient.invalidateQueries({
      queryKey: useWorkflowInstanceQuery.getKey({ id: instanceId }),
    });
    invalidateCounts();
  };

  const run = async (
    instanceId: string,
    action: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> => {
    setErrorMessage(null);
    try {
      await action();
      showSnackbar("success", success);
      refresh(instanceId);
      return true;
    } catch (error) {
      const message = tErrors(workflowErrorOf(error).code);
      setErrorMessage(message);
      showSnackbar("error", message);
      return false;
    }
  };

  return {
    errorMessage,
    clearError: () => {
      setErrorMessage(null);
    },
    isPending: reassign.isPending || add.isPending,
    reassign: (instanceId: string, taskId: string, toUserId: string) =>
      run(
        instanceId,
        () => reassign.mutateAsync({ input: { taskId, toUserId } }),
        t("reassigned"),
      ),
    addAssignee: (instanceId: string, stepKey: string, userId: string) =>
      run(
        instanceId,
        () => add.mutateAsync({ input: { instanceId, stepKey, userId } }),
        t("added"),
      ),
    refresh,
  };
};
