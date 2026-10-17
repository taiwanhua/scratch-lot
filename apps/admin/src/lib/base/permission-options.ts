import type { ReactNode } from "react";

import { WILDCARD_ACTION } from "@repo/domain/permission";
import type { TreeNode } from "@repo/ui/tree";

/**
 * 人員條件「權限」的選項樹(`audiencePermissionOptions`,= 權限矩陣的顯示樹:操作者自己持有的
 * 模組 / 權限)。顯示沿用權限矩陣的排法:模組列在前、底下先列自己這層的權限(「全部(`*`)」最前),
 * 再列子模組;列尾帶 key。差別只在**只有權限列可勾**,模組列只是分組。
 *
 * 值就是權限 key;條件判斷只認實際授予(含 `*` 展開)的有效權限,不套用超級管理員的略過
 * (正本 `docs/modules/data-scope.md`、`@repo/domain/audience`)。
 */

export interface PermissionOptionPermission {
  key: string;
  name: string;
  action: string;
}

export interface PermissionOptionModule {
  key: string;
  name: string;
  permissions?: readonly PermissionOptionPermission[] | null;
  children?: readonly PermissionOptionModule[] | null;
}

const wildcardFirst = (
  left: PermissionOptionPermission,
  right: PermissionOptionPermission,
): number =>
  Number(right.action === WILDCARD_ACTION) -
  Number(left.action === WILDCARD_ACTION);

const permissionName = (
  permission: PermissionOptionPermission,
  wildcardLabel: string,
): string =>
  permission.action === WILDCARD_ACTION ? wildcardLabel : permission.name;

/** 權限 key → 欄位標籤上顯示的「模組 · 權限」。 */
export const permissionLabels = (
  modules: readonly PermissionOptionModule[],
  wildcardLabel: string,
): Map<string, string> => {
  const labels = new Map<string, string>();
  const visit = (nodes: readonly PermissionOptionModule[]) => {
    for (const node of nodes) {
      for (const permission of node.permissions ?? []) {
        labels.set(
          permission.key,
          `${node.name} · ${permissionName(permission, wildcardLabel)}`,
        );
      }
      visit(node.children ?? []);
    }
  };
  visit(modules);
  return labels;
};

/** 所有模組列的 id(= 模組 key):勾選框停用、預設展開都用它。 */
export const permissionModuleKeys = (
  modules: readonly PermissionOptionModule[],
): string[] =>
  modules.flatMap((node) => [
    node.key,
    ...permissionModuleKeys(node.children ?? []),
  ]);

const matches = (needle: string, ...texts: string[]): boolean =>
  texts.some((text) => text.toLowerCase().includes(needle));

/**
 * 依關鍵字過濾:模組名稱 / key 命中 → 整個模組留下;權限名稱 / key 命中 → 留下那幾筆權限與祖先模組。
 */
export const filterPermissionOptions = (
  modules: readonly PermissionOptionModule[],
  keyword: string,
  wildcardLabel: string,
): PermissionOptionModule[] => {
  const needle = keyword.trim().toLowerCase();
  if (needle === "") {
    return [...modules];
  }
  return modules.flatMap((node) => {
    if (matches(needle, node.name, node.key)) {
      return [node];
    }
    const permissions = (node.permissions ?? []).filter((permission) =>
      matches(
        needle,
        permissionName(permission, wildcardLabel),
        permission.key,
      ),
    );
    const children = filterPermissionOptions(
      node.children ?? [],
      keyword,
      wildcardLabel,
    );
    if (permissions.length === 0 && children.length === 0) {
      return [];
    }
    return [{ ...node, permissions, children }];
  });
};

/** 選項樹 → `Tree` 的節點(列尾 key 由呼叫端給樣式)。 */
export const toPermissionTreeNodes = (
  modules: readonly PermissionOptionModule[],
  wildcardLabel: string,
  suffixOf: (key: string) => ReactNode,
): TreeNode[] =>
  modules.map((node) => {
    const children: TreeNode[] = [
      ...(node.permissions ?? []).toSorted(wildcardFirst).map((permission) => ({
        id: permission.key,
        label: permissionName(permission, wildcardLabel),
        labelSuffix: suffixOf(permission.key),
      })),
      ...toPermissionTreeNodes(node.children ?? [], wildcardLabel, suffixOf),
    ];
    return {
      id: node.key,
      label: node.name,
      labelSuffix: suffixOf(node.key),
      children: children.length === 0 ? undefined : children,
    };
  });
