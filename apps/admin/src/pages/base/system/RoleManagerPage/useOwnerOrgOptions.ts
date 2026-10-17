import { useMemo } from "react";

import { useOrgTreeQuery } from "@repo/graphql";

import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { type OrgOption, flattenOrgs } from "@/lib/base/org-tree";

import { ORG_MANAGER_VIEW_PERMISSION } from "./role-manager-permissions";

const EMPTY_OPTIONS: readonly OrgOption[] = [];

/**
 * 操作者**管理範圍**內的組織選項(ADR-0003「擁有組織 = 角色的管轄邊界」)。
 * 管理範圍就是 `orgTree` 回的那棵樹,但 api 把它掛在 `system.org-manager.view` 底下 —
 * 沒有那個權限時只留「當前組織」一個選項(`CreateRoleInput.ownerOrgId` 缺席即取當前組織,GQL-06)。
 *
 * 兩個地方用它,所以住在頁面根目錄而不是某個子資料夾(#246 的 3):
 * 新增 / 編輯角色的「擁有組織」欄位,與左清單上方的「擁有組織」篩選下拉。
 */
export const useOwnerOrgOptions = () => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const me = useMe();

  const isTreeAvailable = hasPermission(ORG_MANAGER_VIEW_PERMISSION);
  const orgTree = useOrgTreeQuery(session.client, undefined, {
    enabled: isTreeAvailable,
  });
  const currentOrg = me.data?.me.currentOrg ?? null;

  const options = useMemo<readonly OrgOption[]>(() => {
    const nodes = orgTree.data?.orgTree;
    if (nodes !== undefined && nodes.length > 0) {
      return flattenOrgs(nodes);
    }
    if (currentOrg === null) {
      return EMPTY_OPTIONS;
    }
    return [
      {
        id: currentOrg.id,
        name: currentOrg.name,
        path: currentOrg.name,
        outOfScope: false,
      },
    ];
  }, [orgTree.data?.orgTree, currentOrg]);

  return {
    options,
    /** 預設帶當前組織(role-manager.md);它不在管理範圍內時退回第一個選項 */
    defaultOrgId:
      options.find((option) => option.id === currentOrg?.id)?.id ??
      options.at(0)?.id ??
      "",
    isLoading: isTreeAvailable && orgTree.isLoading,
  };
};
