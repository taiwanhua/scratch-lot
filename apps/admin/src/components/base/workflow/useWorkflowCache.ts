import { useQueryClient } from "@tanstack/react-query";

import {
  type WorkflowInstanceFieldsFragment,
  useMyApplicationsQuery,
  useMyTasksQuery,
  useWorkflowInstanceQuery,
} from "@repo/graphql";

import { useInvalidateApplyCenterCounts } from "@/hooks/base/useApplyCenterCounts";

/**
 * 審核動作之後的快取維護(DATA-04):有回傳的實例就先寫回單筆,再失效實例、「我的申請」、「待我審核」
 * 與申請中心的 badge 數字(提交本身由 `useFormSubmissionCache` 處理)。
 */
export const useWorkflowCache = () => {
  const queryClient = useQueryClient();
  const invalidateCounts = useInvalidateApplyCenterCounts();
  return (instanceId: string, instance?: WorkflowInstanceFieldsFragment) => {
    const key = useWorkflowInstanceQuery.getKey({ id: instanceId });
    if (instance !== undefined) {
      queryClient.setQueryData(key, { workflowInstance: { instance } });
    }
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({
      queryKey: useMyTasksQuery.getKey({ input: {} }).slice(0, 1),
    });
    void queryClient.invalidateQueries({
      queryKey: useMyApplicationsQuery.getKey({ input: {} }).slice(0, 1),
    });
    invalidateCounts();
  };
};
