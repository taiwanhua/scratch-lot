import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  useDataScopeRuleQuery,
  useDataScopeTargetsQuery,
  useOrgTreeQuery,
  useRolesQuery,
  useUsersQuery,
} from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { type OrgNodeLike, flattenOrgs } from "@/lib/base/org-tree";
import { roleMenuOptions, sortRolesByOwnerOrg } from "@/lib/base/role-options";

import {
  DATA_SCOPE_PERMISSIONS,
  ROLE_MANAGER_VIEW_PERMISSION,
  USER_MANAGER_VIEW_PERMISSION,
} from "./data-scope-permissions";
import type { PickerOption } from "./data-scope-types";

/** 選擇器的清單一次取滿(角色與使用者在單一租戶內都是小清單,不做分頁)。 */
const PICKER_PAGE = { page: 1, pageSize: 100 };

/**
 * 資料範圍頁的資料層:資料目標清單(每筆自帶 `hasRule`)、選中目標的規則,
 * 以及套用對象 / 條件值選擇器要用的角色、使用者、組織樹。
 *
 * 左清單的「已設規則」讀 `DataScopeTarget.hasRule`(#246 的 1)。在那之前這裡對每個目標
 * 各發一次 `dataScopeRule` 併進 `useQueries`,目標一多就是 N+1;現在只查選中的那一個。
 */
export const useDataScopeData = () => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const targets = useDataScopeTargetsQuery(session.client);
  const targetList = useMemo(
    () => targets.data?.dataScopeTargets.targets ?? [],
    [targets.data],
  );

  /** 目標以 id 指定:一列 = 一個模組,同一個 collection 可能有好幾列。 */
  const [pickedTargetId, setPickedTargetId] = useState<string | null>(null);
  /** 還沒點過任何目標時預設選第一個(不在 effect 內 setState,REACT-06)。 */
  const firstTargetId = targetList.length > 0 ? targetList[0].id : null;
  const selectedTargetId = pickedTargetId ?? firstTargetId;
  const selectedIndex = targetList.findIndex(
    (item) => item.id === selectedTargetId,
  );
  const target = selectedIndex === -1 ? undefined : targetList[selectedIndex];

  /** 只查選中的那一個目標的規則;「有沒有規則」由目標清單自己的 `hasRule` 回答。 */
  const selectedRule = useDataScopeRuleQuery(
    session.client,
    { targetId: selectedTargetId ?? "" },
    { enabled: selectedTargetId !== null },
  );

  const roles = useRolesQuery(
    session.client,
    { input: PICKER_PAGE },
    { enabled: hasPermission(ROLE_MANAGER_VIEW_PERMISSION) },
  );
  const users = useUsersQuery(
    session.client,
    { input: PICKER_PAGE },
    { enabled: hasPermission(USER_MANAGER_VIEW_PERMISSION) },
  );
  /** `orgTree` 只受管理範圍限制、沒有權限守門,所以不必 gate。 */
  const orgTree = useOrgTreeQuery(session.client);

  /**
   * 套用對象「指定角色」的選項:每列「角色名稱 — 擁有組織」(#261 的 8)——
   * 每個租戶都有自己的「租戶管理員」,根組織視角只看角色名稱完全分不出來。
   *
   * **依擁有組織排序**(#372):選單以擁有組織分組,而 MUI 的 `groupBy` 只合併相鄰的同值,
   * api 回的順序裡同組織的角色被隔開時,同一個組織的標題會出現兩次。
   */
  const roleOptions: PickerOption[] = sortRolesByOwnerOrg(
    roleMenuOptions(roles.data?.roles.items ?? []).map((role) => ({
      id: role.id,
      label: role.label,
      name: role.name,
      ownerOrgId: role.ownerOrgId,
      ownerOrgName: role.ownerOrgName,
      tenantTopId: role.tenantTopId,
      tenantTopName: role.tenantTopName,
    })),
  );
  const userOptions: PickerOption[] = (users.data?.users.items ?? []).map(
    (user) => ({ id: user.id, label: `${user.name}(${user.account})` }),
  );
  const orgNodes = useMemo<readonly OrgNodeLike[]>(
    () => orgTree.data?.orgTree ?? [],
    [orgTree.data],
  );
  const orgOptions = useMemo(() => flattenOrgs(orgNodes), [orgNodes]);

  /** 儲存後精準失效(DATA-04):該目標的規則(編輯器 + 左清單的「已設規則」)與目標清單。 */
  const invalidate = async (targetId: string) => {
    await queryClient.invalidateQueries({
      queryKey: useDataScopeRuleQuery.getKey({ targetId }),
    });
    await queryClient.invalidateQueries({
      queryKey: useDataScopeTargetsQuery.getKey(),
    });
  };

  return {
    canEdit: hasPermission(DATA_SCOPE_PERMISSIONS.edit),
    targets: targetList,
    isTargetsLoading: targets.isLoading,
    selectedTargetId,
    selectTarget: setPickedTargetId,
    target,
    rule: selectedRule.data?.dataScopeRule.rule ?? null,
    isRuleLoading: selectedRule.isPending,
    roleOptions,
    userOptions,
    orgNodes,
    orgOptions,
    invalidate,
  };
};
