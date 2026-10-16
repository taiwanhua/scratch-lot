import {
  type FormSubmissionStatus,
  type MyApplicationsQuery,
  useMyApplicationsQuery,
} from "@repo/graphql";

import { useSession } from "./useSession";

export type MyApplication =
  MyApplicationsQuery["myApplications"]["items"][number];

export interface MyApplicationsFilters {
  moduleKey: string | null;
  formKey: string | null;
  status: FormSubmissionStatus | null;
  page: number;
  pageSize: number;
}

/**
 * 申請中心「我的申請」(Spec 6b §4「申請中心的資料來源」):我送的、走過流程(或該表單目前綁了流程)的提交,
 * 跨模組、以租戶為邊界;`activeSteps` 是目前實例進行中的關卡(平行時多個)。
 */
export const useMyApplications = (filters: MyApplicationsFilters) => {
  const { session } = useSession();
  const query = useMyApplicationsQuery(session.client, {
    input: {
      page: filters.page,
      pageSize: filters.pageSize,
      ...(filters.moduleKey !== null && { moduleKey: filters.moduleKey }),
      ...(filters.formKey !== null && { formKey: filters.formKey }),
      ...(filters.status !== null && { status: filters.status }),
    },
  });
  return {
    items: query.data?.myApplications.items ?? [],
    totalCount: query.data?.myApplications.totalCount ?? 0,
    isLoading: query.isLoading,
    error: query.error,
  };
};
