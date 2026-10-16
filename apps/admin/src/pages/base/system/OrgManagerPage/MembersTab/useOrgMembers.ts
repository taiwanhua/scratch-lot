import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";

import {
  type OrgMembersQueryVariables,
  useAddOrgMembersMutation,
  useOrgMembersQuery,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";

import {
  type OrgManagerErrorCode,
  orgManagerErrorOf,
} from "../org-manager-error";
import { ORG_MEMBERS_PAGE_SIZE, type OrgMemberRow } from "../org-manager-types";

/**
 * 成員清單的頁碼存在網址 `?members=`(REACT-14),連同它屬於哪個組織:換了組織(`?detail=` 變了)頁碼自然回到第一頁,
 * 不必由選組織的那一邊來清。
 */
const membersSchema = z
  .object({ org: z.string(), page: z.number().int().min(1) })
  .default({ org: "", page: 1 });

/**
 * 「成員」頁籤的資料層(#377):`orgMembers` 清單 + 增量加入。
 *
 * **移除不在這裡**:移除所屬組織會牽動失去資格的角色與 dry-run 三檔(ADR-0003),
 * 入口維持使用者管理的「選擇所屬組織」一處(org-manager.md「成員」節)。
 */
export const useOrgMembers = (orgId: string, onAdded: () => void) => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [members, setMembers] = useUrlState("members", membersSchema);
  const page = members.org === orgId ? members.page : 1;
  /** 第一頁寫回預設值(key 從網址拿掉)。 */
  const setPage = (next: number) => {
    setMembers(next === 1 ? { org: "", page: 1 } : { org: orgId, page: next });
  };
  const [errorCode, setErrorCode] = useState<OrgManagerErrorCode | null>(null);

  const variables = useMemo<OrgMembersQueryVariables>(
    () => ({ orgId, input: { page, pageSize: ORG_MEMBERS_PAGE_SIZE } }),
    [orgId, page],
  );
  const query = useOrgMembersQuery(session.client, variables);

  const add = useAddOrgMembersMutation(session.client, {
    onSuccess: async () => {
      setErrorCode(null);
      // 加完之後候選少了幾位、清單多了幾位:兩把都要重查(DATA-02 / 04)
      await queryClient.invalidateQueries({
        queryKey: useOrgMembersQuery.getKey(variables),
      });
      await queryClient.invalidateQueries({
        queryKey: ["OrgMemberCandidates"],
      });
      onAdded();
    },
    onError: (error: unknown) => {
      setErrorCode(orgManagerErrorOf(error).code);
    },
  });

  const rows: readonly OrgMemberRow[] = query.data?.orgMembers.items ?? [];

  return {
    rows,
    totalCount: query.data?.orgMembers.totalCount ?? 0,
    isLoading: query.isLoading,
    page,
    setPage,
    errorCode,
    clearError: () => {
      setErrorCode(null);
    },
    isSubmitting: add.isPending,
    add: (userIds: readonly string[]) => {
      setErrorCode(null);
      add.mutate({ input: { orgId, userIds: [...userIds] } });
    },
  };
};
