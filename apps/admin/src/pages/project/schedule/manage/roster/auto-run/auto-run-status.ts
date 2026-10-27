import { ClientError, useScheduleAutoRunStatusQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import { useRosterCheck } from "../check-panel/roster-check-context";
import { ROSTER_QUERY_ROOT } from "../roster-context";

/**
 * 套用範本與自動排班共用的狀態(規格 14.4、14.5):能不能自動排班、別人的自動排班是否執行中、
 * 最近一次自動排班的摘要、週範本選項、條件的預設值。查詢 key 掛在排班表的前綴下,任何寫入後一起重查。
 * 只能用在排班表頁(`RosterCheckProvider`)裡。
 */
export const useAutoRunStatus = () => {
  const { session } = useSession();
  const { data, month } = useRosterCheck();
  const variables = {
    input: { month, ...(data === undefined ? {} : { orgId: data.orgId }) },
  };
  const query = useScheduleAutoRunStatusQuery(session.client, variables, {
    queryKey: [...ROSTER_QUERY_ROOT, "autoRun", variables],
    enabled: data !== undefined,
  });
  return query.data?.scheduleAutoRunStatus;
};

/** 自動排班 / 套用範本 / 清除被擋的原因(`extensions.reason`;api 正本 `autoRunBlockedError`)。 */
export type AutoRunBlockedReason = "AUTO_RUN_IN_PROGRESS" | "ALREADY_PUBLISHED";

export const autoRunBlockedReasonOf = (
  error: unknown,
): AutoRunBlockedReason | null => {
  if (!(error instanceof ClientError)) {
    return null;
  }
  const { errors } = error.response as {
    errors?: { extensions?: { reason?: unknown } }[];
  };
  const reason = errors?.[0]?.extensions?.reason;
  return reason === "AUTO_RUN_IN_PROGRESS" || reason === "ALREADY_PUBLISHED"
    ? reason
    : null;
};
