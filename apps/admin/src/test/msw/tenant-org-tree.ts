import type { TenantOrgTreeQuery } from "@repo/graphql";

export type TestTenantOrgNode = TenantOrgTreeQuery["tenantOrgTree"][number];

interface NodeLike {
  id: string;
  name: string;
  parentId?: string | null;
  enabled?: boolean;
  children?: readonly NodeLike[];
}

export interface TenantTreeFlags {
  /** 可見範圍內的組織 id;不給 = 全部可見 */
  visibleIds?: readonly string[];
  /** 管理範圍內的組織 id;不給 = 全部可管理 */
  managedIds?: readonly string[];
}

/**
 * 組織選擇器的整棵租戶樹(`tenantOrgTree`)夾具:把一般的組織樹節點加上可見 / 可管理旗標。
 * `OrgTreeSelect` 的 `visible` / `tenant` 模式查它。
 */
export const toTenantTree = (
  nodes: readonly NodeLike[],
  flags: TenantTreeFlags = {},
): TestTenantOrgNode[] =>
  nodes.map((node) => ({
    __typename: "TenantOrgNode" as const,
    id: node.id,
    name: node.name,
    parentId: node.parentId ?? null,
    enabled: node.enabled ?? true,
    isVisible: flags.visibleIds?.includes(node.id) ?? true,
    isManaged: flags.managedIds?.includes(node.id) ?? true,
    children: toTenantTree(node.children ?? [], flags) as never,
  }));
