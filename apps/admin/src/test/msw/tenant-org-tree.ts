import { HttpResponse } from "msw";

import type { TenantOrgTreeQuery } from "@repo/graphql";

import { api } from "./server";

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

/** `tenantOrgTree` 回固定的樹(組織選擇器 `visible` / `tenant` 模式的假 api);沒給 = 只有 `org-1`。 */
export const tenantOrgTreeHandler = (
  nodes: readonly TestTenantOrgNode[] = toTenantTree([
    { id: "org-1", name: "總部" },
  ]),
) =>
  api.query("TenantOrgTree", () =>
    HttpResponse.json({ data: { tenantOrgTree: nodes } }),
  );

/** world 的租戶樹選項:給樹 = 攔下回這棵;`null` 或沒給 = 不攔(由測試或別的 world 提供)。 */
export type OrgTreeOption = readonly TestTenantOrgNode[] | null;

/**
 * 給 world 用:只有明確給樹才攔。沒給也不攔,免得 world 先登記的 handler 蓋掉測試自己的 `TenantOrgTree`
 * (同名 handler 先登記的先回)。
 */
export const orgTreeHandlers = (nodes?: OrgTreeOption) =>
  nodes ? [tenantOrgTreeHandler(nodes)] : [];
