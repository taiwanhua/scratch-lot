import { useQueryClient } from "@tanstack/react-query";

import { useMeQuery, useOrgQuery, useOrgTreeQuery } from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { type OrgNodeLike, findOrgNode, rootOrgId } from "@/lib/base/org-tree";

import { ORG_MANAGER_PERMISSIONS } from "./org-manager-permissions";
import type { OrgActionAbility } from "./org-manager-types";

/**
 * 組織管理頁的資料層:組織樹、選中組織的單筆資料、權限判斷與失效。
 *
 * **視角完全由資料決定**(#138 不做兩套頁):`orgTree` 的樹根在根組織視角是根組織
 * (`parentId === null`)、在租戶視角是租戶頂層(`parentId` 有值)。加上操作者有沒有
 * `tenant-ops.*` 那三筆權限,就足以決定畫面長什麼樣,不需要「我是不是超級管理員」這種旗標。
 */
export const useOrgManagerData = (
  /** 網址 `?edit=<id>` 要編輯的組織:有就以它為選中的組織(編輯彈窗編的就是選中的那一個) */
  editOrgId: string | null = null,
) => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const ability: OrgActionAbility = {
    canCreateChild: hasPermission(ORG_MANAGER_PERMISSIONS.createChild),
    canEdit: hasPermission(ORG_MANAGER_PERMISSIONS.edit),
    canToggleEnabled: hasPermission(ORG_MANAGER_PERMISSIONS.toggleEnabled),
    canMove: hasPermission(ORG_MANAGER_PERMISSIONS.move),
    canDelete: hasPermission(ORG_MANAGER_PERMISSIONS.delete),
    canAddMembers: hasPermission(ORG_MANAGER_PERMISSIONS.addMembers),
    canProvision: hasPermission(ORG_MANAGER_PERMISSIONS.provision),
    canRevokeProvision: hasPermission(ORG_MANAGER_PERMISSIONS.revokeProvision),
    canTransferOwner: hasPermission(ORG_MANAGER_PERMISSIONS.transferOwner),
    canSetVisibility: hasPermission(ORG_MANAGER_PERMISSIONS.setVisibility),
    canSetTimezone: hasPermission(ORG_MANAGER_PERMISSIONS.setTimezone),
  };

  /** 選中的組織存在網址 `?detail=<id>`(REACT-14);沒有 = 樹根。 */
  const [urlPickedOrgId, setPickedOrgId] = useUrlSelectedId();
  const pickedOrgId = editOrgId ?? urlPickedOrgId;

  const orgTree = useOrgTreeQuery(session.client);
  const orgNodes: readonly OrgNodeLike[] = orgTree.data?.orgTree ?? [];
  const treeRootId = rootOrgId(orgNodes);

  /** 還沒點過任何節點時預設選樹根(不在 effect 內 setState,REACT-06)。 */
  // 網址上的組織不在樹裡(手改、換了組織、已刪除)→ 退回樹根
  const selectedOrgId =
    pickedOrgId !== null && findOrgNode(orgNodes, pickedOrgId) !== null
      ? pickedOrgId
      : treeRootId;

  const selected = useOrgQuery(
    session.client,
    { id: selectedOrgId ?? "" },
    { enabled: selectedOrgId !== null },
  );
  const org = selected.data?.org;

  /**
   * 樹根到底是平台根組織還是租戶頂層,**不能看 `OrgNode.parentId`** — api 的 `buildForest`
   * 把本棵樹的樹根一律對外回 `parentId: null`(`orgs.service.ts`),租戶視角的租戶頂層也是 null,
   * 於是它的子組織被誤判成租戶、掛上「租戶」標籤(#186 ④)。
   * `org(id).isSystem` 才是「這是平台根組織」的事實;樹根沒被點掉時與 `selected` 同一把 key,不多發一次請求。
   */
  const treeRoot = useOrgQuery(
    session.client,
    { id: treeRootId ?? "" },
    { enabled: treeRootId !== null },
  );
  const isRootPerspective = treeRoot.data?.org.isSystem ?? false;

  /** 寫入成功後精準失效(DATA-02 / 04):樹、被改到的那一筆、以及 `me`(商標 / 組織名進側欄)。 */
  const invalidate = async (orgId?: string) => {
    await queryClient.invalidateQueries({ queryKey: useOrgTreeQuery.getKey() });
    await queryClient.invalidateQueries({
      queryKey: useOrgQuery.getKey({ id: orgId ?? selectedOrgId ?? "" }),
    });
    await queryClient.invalidateQueries({ queryKey: useMeQuery.getKey() });
  };

  return {
    ability,
    orgNodes,
    isOrgTreeLoading: orgTree.isLoading,
    isRootPerspective,
    treeRootId,
    selectedOrgId,
    selectOrg: setPickedOrgId,
    org,
    isOrgLoading: selected.isLoading,
    /** 樹已到手:網址上的組織不在樹裡就是不存在或看不到 */
    isOrgTreeReady: orgTree.isSuccess,
    invalidate,
  };
};
