import { useMyTasksQuery } from "@repo/graphql";

import { useSession } from "./useSession";

export interface MyTasksFilters {
  moduleKey: string | null;
  formKey: string | null;
  /** false = 待處理(`pending`);true = 已處理(核准 / 駁回 / 退回 / 逾時決定) */
  done: boolean;
  page: number;
  pageSize: number;
}

/**
 * 申請中心「待我審核」(Spec 6b §4):派給我的任務,跨模組、以租戶為邊界;
 * 標題與申請人讀**實例快照**(該修訂的),單據重送後只審過舊修訂的人看到的仍是舊標題。
 */
export const useMyTasks = (filters: MyTasksFilters) => {
  const { session } = useSession();
  const query = useMyTasksQuery(session.client, {
    input: {
      done: filters.done,
      page: filters.page,
      pageSize: filters.pageSize,
      ...(filters.moduleKey !== null && { moduleKey: filters.moduleKey }),
      ...(filters.formKey !== null && { formKey: filters.formKey }),
    },
  });
  return {
    items: query.data?.myTasks.items ?? [],
    totalCount: query.data?.myTasks.totalCount ?? 0,
    isLoading: query.isLoading,
    error: query.error,
  };
};
