import { useQueryClient } from "@tanstack/react-query";

import { useMeQuery, useModuleTreeQuery } from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";

import { findModuleNode, firstModuleId } from "./module-admin-tree";
import { MODULE_MANAGER_PERMISSIONS } from "./module-manager-permissions";
import type { ModuleAdminNodeLike } from "./module-manager-types";

/**
 * 模組與權限頁的資料層:全樹、選中的那一枝、權限判斷與失效。
 *
 * 這一頁只有一個查詢(`moduleTree` 回全樹),選中的模組直接從樹上取 —— 不像組織管理
 * 還要 `org(id)` 補單筆,所以沒有第二個查詢,也就沒有「樹與明細不同步」的空窗。
 */
export const useModuleManagerData = () => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const canToggleEnabled = hasPermission(
    MODULE_MANAGER_PERMISSIONS.toggleEnabled,
  );
  /** 換圖示與停用是兩把鑰匙;只有這一把時仍看得到目前圖示,只是不能換 */
  const canSetIcon = hasPermission(MODULE_MANAGER_PERMISSIONS.setIcon);

  /** 選中的節點存在網址 `?detail=<id>`(REACT-14);沒有 = 第一棵樹的根。 */
  const [pickedModuleId, setPickedModuleId] = useUrlSelectedId();

  const moduleTree = useModuleTreeQuery(session.client);
  const nodes: readonly ModuleAdminNodeLike[] =
    moduleTree.data?.moduleTree ?? [];

  /** 還沒點過任何節點時預設選第一棵樹的根(不在 effect 內 setState,REACT-06)。 */
  // 網址上的節點不在樹裡(手改、換了組織)→ 退回第一棵樹的根
  const selectedModuleId =
    pickedModuleId !== null && findModuleNode(nodes, pickedModuleId) !== null
      ? pickedModuleId
      : firstModuleId(nodes);
  const selectedModule =
    selectedModuleId === null ? null : findModuleNode(nodes, selectedModuleId);

  /**
   * 寫入成功後精準失效(DATA-02 / 04):治理面的全樹,以及 `me` ——
   * 停用模組會讓側欄少一項(`me.modules` 吃 enabled 當過濾,ADR-0011 步驟 6),
   * 停用權限會讓頁內按鈕消失(步驟 4),兩者都是操作者自己立刻看得到的變化。
   */
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: useModuleTreeQuery.getKey(),
    });
    await queryClient.invalidateQueries({ queryKey: useMeQuery.getKey() });
  };

  return {
    canToggleEnabled,
    canSetIcon,
    nodes,
    isLoading: moduleTree.isLoading,
    selectedModuleId,
    selectModule: setPickedModuleId,
    selectedModule,
    invalidate,
  };
};
