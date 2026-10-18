import { ModuleSidebarType } from "@repo/graphql";

import type { ModuleAdminNodeLike } from "./module-manager-types";

/**
 * `moduleTree` 的走訪工具(只有本頁用,所以留在頁面資料夾而不是 `lib/`,STRUCT-03)。
 * `children` 在最深一層的 codegen 型別上不存在,一律以 `?? []` 取用。
 */

/** 深度優先攤平整棵樹,順序 = 畫面上的順序。 */
export const flattenModules = (
  nodes: readonly ModuleAdminNodeLike[],
): ModuleAdminNodeLike[] =>
  nodes.flatMap((node) => [node, ...flattenModules(node.children ?? [])]);

/** 所有節點 id(樹的展開狀態用全集表示)。 */
export const allModuleIds = (nodes: readonly ModuleAdminNodeLike[]): string[] =>
  flattenModules(nodes).map((node) => node.id);

/**
 * 這個節點只是**權限容器**,不是隱藏頁。
 *
 * 權限容器 = `sidebarType = hidden` 且**沒有 route** 的節點(`api` 權限樹、
 * `system.org-manager.tenant-ops`):它不對應任何畫面,存在的理由是讓底下那幾條權限
 * 可以單獨授予 / 停用。樹上把它標成「隱藏頁」會讓人一直找那個找不到的頁面。
 *
 * 判準**直接讀 `moduleTree` 回的 `route`**(語意正本
 * `docs/modules/module-manager.md` 的 api 介面節)。在那之前 api 沒回 route,這裡改用
 * 「key 不以 `-page` 結尾」當等價判準 —— 它靠的是 seed 的命名規約,
 * 規約一鬆就悄悄失準;現在看的是同一件事本身。
 */
export const isPermissionContainer = (node: ModuleAdminNodeLike): boolean =>
  node.sidebarType === ModuleSidebarType.Hidden &&
  (node.route ?? null) === null;

/** 依 id 找節點(含它的子樹);找不到回 null。 */
export const findModuleNode = (
  nodes: readonly ModuleAdminNodeLike[],
  id: string,
): ModuleAdminNodeLike | null => {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const deeper = findModuleNode(node.children ?? [], id);
    if (deeper !== null) {
      return deeper;
    }
  }
  return null;
};

/** 預設選中的節點 = 第一棵樹的根;空樹回 null。 */
export const firstModuleId = (
  nodes: readonly ModuleAdminNodeLike[],
): string | null => nodes[0]?.id ?? null;

/**
 * 權限的顯示順序:`<模組 key>.*` 恆排最前,其餘依 key
 * (`docs/modules/module-manager.md`「回傳欄位語意」— api 已照這個順序回,
 * 這裡再排一次是為了不讓夾具或快取的順序決定畫面)。
 */
export const sortPermissions = <T extends { key: string }>(
  permissions: readonly T[],
): T[] =>
  permissions.toSorted((left, right) => {
    const leftIsAll = left.key.endsWith(".*");
    const rightIsAll = right.key.endsWith(".*");
    if (leftIsAll !== rightIsAll) {
      return leftIsAll ? -1 : 1;
    }
    return left.key.localeCompare(right.key);
  });
