import { useState } from "react";

import { useMyDelegateCandidatesQuery } from "@repo/graphql";

import type { UserCandidates } from "@/components/base/UserPicker/useUserCandidates";
import { useSession } from "@/hooks/base/useSession";

/** 候選一頁幾個(api 上限 100;關鍵字丟回 api 查)。 */
const PAGE_SIZE = 50;

/**
 * 可選的代理人(`myDelegateCandidates`):同一最上層組織、啟用中、不含自己。
 * 不需要使用者管理的權限(個人設定所有登入者都能用),所以不借 `users` 查詢。
 */
export const useDelegateCandidates = (): UserCandidates => {
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const trimmed = keyword.trim();
  const query = useMyDelegateCandidatesQuery(
    session.client,
    {
      input: {
        page: 1,
        pageSize: PAGE_SIZE,
        ...(trimmed !== "" && { keyword: trimmed }),
      },
    },
    { retry: false },
  );
  return {
    candidates: (query.data?.myDelegateCandidates.items ?? []).map((user) => ({
      id: user.id,
      name: user.name,
      account: user.account,
      enabled: true,
    })),
    setKeyword,
    isFetching: query.isFetching,
    isForbidden: query.isError,
  };
};
