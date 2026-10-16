import { useState } from "react";

import { useUsersQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

/** 候選一頁幾個(api 上限 100;關鍵字丟回 api 查)。 */
const PAGE_SIZE = 50;

export interface UserCandidate {
  id: string;
  name: string;
  account: string;
  enabled: boolean;
}

/**
 * 使用者候選(審核者來源「指定使用者」、改派 / 新增審核者、複製組織與角色的目標):借 `users` 查詢,
 * 關鍵字丟回 api。api 沒有專給流程用的候選查詢,所以要有 `system.user-manager.view`
 * (租戶管理員模板預設含);沒有時清單是空的,呼叫端顯示提示。
 */
export const useUserCandidates = () => {
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const trimmed = keyword.trim();
  const query = useUsersQuery(
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
  const candidates: UserCandidate[] = (query.data?.users.items ?? []).map(
    (user) => ({
      id: user.id,
      name: user.name,
      account: user.account,
      enabled: user.enabled,
    }),
  );
  return {
    candidates,
    setKeyword,
    isFetching: query.isFetching,
    isForbidden: query.isError,
  };
};
