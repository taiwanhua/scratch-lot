import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useApplyCenterCountsQuery } from "@repo/graphql";

import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";

/**
 * 申請中心的權限(seed 正本 `apps/db-migrator/seeds/base/modules/apply-center.ts`;admin 不能 import
 * db-migrator,STRUCT-01)。沒有它的人打 `applyCenterCounts` 會被拒,所以不發請求。
 */
const APPLY_CENTER_VIEW_PERMISSION = "apply-center.view";

/**
 * 申請中心頁籤與側欄的 badge 數字(`applyCenterCounts`,條件與兩個列表的預設篩選相同):
 * `myTasks` = 待我處理的任務數、`myApplications` = 我進行中(審核中 / 被退回)的申請數。
 * 進站取一次,之後靠寫入端失效重查(`useInvalidateApplyCenterCounts`),不輪詢。
 * 申請中心頁傳 `refetchOnMount: "always"`:每次進頁都重取一次(側欄那一份已在快取裡也一樣)。
 */
export const useApplyCenterCounts = ({
  refetchOnMount = true,
}: { refetchOnMount?: boolean | "always" } = {}) => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const query = useApplyCenterCountsQuery(session.client, undefined, {
    enabled: hasPermission(APPLY_CENTER_VIEW_PERMISSION),
    refetchOnMount,
  });
  return {
    myTasks: query.data?.applyCenterCounts.myTasks ?? 0,
    myApplications: query.data?.applyCenterCounts.myApplications ?? 0,
  };
};

/**
 * 會改變任務 / 申請狀態的寫入(送出、審核、改派、撤回、作廢、刪除)之後呼叫:失效 badge 數字(DATA-04 的 (b);
 * 回傳的 payload 沒有計數可寫回)。
 */
export const useInvalidateApplyCenterCounts = () => {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: useApplyCenterCountsQuery.getKey(),
    });
  }, [queryClient]);
};
