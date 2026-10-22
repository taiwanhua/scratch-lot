import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";

import {
  type UsersQueryVariables,
  useMeQuery,
  useOrgQuery,
  useOrgTreeQuery,
  useUserQuery,
  useUsersQuery,
} from "@repo/graphql";

import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { type OrgNodeLike, findOrgNode, rootOrgId } from "@/lib/base/org-tree";

import {
  ORG_MANAGER_VIEW_PERMISSION,
  USER_MANAGER_PERMISSIONS,
} from "./user-manager-permissions";
import {
  USERS_PAGE_SIZE,
  type UserActionAbility,
  type UserRow,
} from "./user-manager-types";

/**
 * 清單的範圍與篩選存在網址 `?list=`(REACT-14):左樹選的組織(`org`,沒選 = 樹根)、搜尋、頁碼。
 * 組織是清單的篩選條件(換組織回第一頁),所以和搜尋、頁碼放同一個 key。
 */
const listSchema = z
  .object({
    org: z.string().nullable().default(null),
    keyword: z.string().default(""),
    page: z.number().int().min(1).default(1),
  })
  .default({ org: null, keyword: "", page: 1 });

/**
 * 使用者管理頁的資料層:組織樹、清單、篩選與權限判斷(ADR-0011「頁內功能」)。
 *
 * 組織樹來自 `orgTree`,而 api 把它掛在 `system.org-manager.view` 底下 — 沒有那個權限時
 * 不送查詢,清單改成「不給 orgId」= 攤開整個管理範圍(治理模組慣例,ADR-0005 的分工表)。
 *
 * **初始狀態**:樹可用時預設選中樹根 = 操作者可見範圍的根,與組織管理頁一致;
 * 樹根還沒到手前不送 `users`(`orgId` 為 null 的查詢會被 api 擋下),右區塊顯示載入中。
 *
 * 擁有者保護(ADR-0009)在前端只需要樹根這一筆:樹根就是「租戶頂層」(租戶視角)或「根組織」
 * (根組織視角)。樹根 `parentId === null` 代表操作者站在根組織 — 一律放行,不標保護;
 * 否則樹根的 `ownerUserId` 就是受保護的那一位(`protectedOwnerUserId`),
 * 而樹根自己就是他「不可被移出」的那個組織(`protectedOwnerOrgId`)。
 */
export const useUserManagerData = () => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const me = useMe();

  const ability: UserActionAbility = {
    canCreate: hasPermission(USER_MANAGER_PERMISSIONS.create),
    canEdit: hasPermission(USER_MANAGER_PERMISSIONS.edit),
    canManageOrgs: hasPermission(USER_MANAGER_PERMISSIONS.manageOrgs),
    canAssignRoles: hasPermission(USER_MANAGER_PERMISSIONS.assignRoles),
    canToggleEnabled: hasPermission(USER_MANAGER_PERMISSIONS.toggleEnabled),
    canCopyOrgRoles:
      hasPermission(USER_MANAGER_PERMISSIONS.view) &&
      hasPermission(USER_MANAGER_PERMISSIONS.manageOrgs) &&
      hasPermission(USER_MANAGER_PERMISSIONS.assignRoles),
    canShowNationalId: hasPermission(USER_MANAGER_PERMISSIONS.showNationalId),
    canEditNationalId: hasPermission(USER_MANAGER_PERMISSIONS.editNationalId),
  };
  const isOrgTreeAvailable = hasPermission(ORG_MANAGER_VIEW_PERMISSION);

  const [list, setList] = useUrlState("list", listSchema);
  const { org: pickedOrgId, keyword, page } = list;

  const orgTree = useOrgTreeQuery(session.client, undefined, {
    enabled: isOrgTreeAvailable,
  });
  const orgNodes: readonly OrgNodeLike[] = orgTree.data?.orgTree ?? [];
  const treeRootId = rootOrgId(orgNodes);

  const treeRoot = useOrgQuery(
    session.client,
    { id: treeRootId ?? "" },
    { enabled: isOrgTreeAvailable && treeRootId !== null },
  );
  const rootOrg = treeRoot.data?.org;
  const protectedOwnerUserId =
    rootOrg === undefined || rootOrg.parentId === null
      ? null
      : (rootOrg.ownerUserId ?? null);
  /**
   * 擁有者「不可被移出」的那一個組織:就是樹根 —— `protectedOwnerUserId`
   * 本來就是從它的 `ownerUserId` 來的,所以不必為此向 api 多要欄位。
   * 沒有受保護的擁有者(根組織視角 / 樹根沒有擁有者)時是 null。
   */
  const protectedOwnerOrgId = protectedOwnerUserId === null ? null : treeRootId;

  /**
   * 初始選中樹根(與組織管理頁一致;不在 effect 內 setState,REACT-06)。
   * 樹還沒回來時是 null — 那段時間不送 `users`(見下方 `enabled`)。
   */
  // 網址上的組織不在樹裡(手改、換了組織)→ 退回樹根;樹不可用時不看網址上的組織(清單攤開整個可見範圍)
  const selectedOrgId =
    pickedOrgId !== null && findOrgNode(orgNodes, pickedOrgId) !== null
      ? pickedOrgId
      : treeRootId;

  /**
   * `orgId` 為 null 一律不送進 input:api 的 `UsersInput.orgId` 是「不給 = 整個可見範圍」,
   * 給 null 會在 `toObjectId` 炸 `orgId is not a valid id: null`。
   */
  const usersVariables = useMemo<UsersQueryVariables>(
    () => ({
      input: {
        ...(selectedOrgId === null ? {} : { orgId: selectedOrgId }),
        page,
        pageSize: USERS_PAGE_SIZE,
        keyword: keyword.trim() === "" ? null : keyword.trim(),
      },
    }),
    [selectedOrgId, page, keyword],
  );
  /** 樹可用時要等樹根到手才查(否則會先閃一次「整個可見範圍」再收斂);樹不可用時直接查整個可見範圍。 */
  const isUsersEnabled = !isOrgTreeAvailable || selectedOrgId !== null;
  const users = useUsersQuery(session.client, usersVariables, {
    enabled: isUsersEnabled,
  });

  const rows: readonly UserRow[] = users.data?.users.items ?? [];
  const totalCount = users.data?.users.totalCount ?? 0;

  /** 換組織 / 換關鍵字都回到第一頁(否則會停在一個不存在的頁碼上看到空清單)。 */
  const selectOrg = (orgId: string | null) => {
    setList((current) => ({ ...current, org: orgId, page: 1 }));
  };
  const setKeyword = (value: string) => {
    setList((current) => ({ ...current, keyword: value, page: 1 }));
  };
  const setPage = (value: number) => {
    setList((current) => ({ ...current, page: value }));
  };

  /**
   * 寫入成功後精準失效(DATA-02 / 04):目前這份清單 + 被改到的那一筆單筆。
   *
   * **改到的是登入者本人時連 `me` 一起失效**:所屬組織是 `me.orgs` 的來源,
   * AppBar 的「當前組織」可切換清單直接讀它 —— 不失效的話,剛把自己加進一個組織,
   * 選單裡還是沒有那一個(`me` 的 `staleTime` 是 Infinity,不會自己過期)。
   * 角色授予(權限)、停用與改名同理都是操作者立刻看得到的變化,所以不分 mutation 一起處理。
   */
  const invalidate = async (userId?: string) => {
    await queryClient.invalidateQueries({
      queryKey: useUsersQuery.getKey(usersVariables),
    });
    if (userId !== undefined) {
      await queryClient.invalidateQueries({
        queryKey: useUserQuery.getKey({ id: userId }),
      });
    }
    if (userId !== undefined && userId === me.data?.me.id) {
      await queryClient.invalidateQueries({ queryKey: useMeQuery.getKey() });
    }
  };

  return {
    ability,
    isOrgTreeAvailable,
    orgNodes,
    isOrgTreeLoading: orgTree.isLoading,
    protectedOwnerUserId,
    protectedOwnerOrgId,
    selectedOrgId,
    /** 網址上點選的組織(`?list=` 的 `org`);沒點過為 null(此時 `selectedOrgId` 是樹根) */
    pickedOrgId,
    selectOrg,
    keyword,
    setKeyword,
    page,
    setPage,
    rows,
    totalCount,
    /** 等樹根的那段時間也算載入中 — 右區塊顯示載入指示,而不是「目前沒有資料」。 */
    isUsersLoading: !isUsersEnabled || users.isLoading,
    invalidate,
  };
};
