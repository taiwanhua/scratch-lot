import { useMemo } from "react";

import {
  type OrgNodeLike,
  type OrgOption,
  findOrgNode,
  flattenOrgs,
  orgTrail,
} from "@/lib/base/org-tree";

export interface UseMoveTargetsOptions {
  nodes: readonly OrgNodeLike[];
  /** 樹根是平台根組織(`org(樹根).isSystem`,#186 ④):租戶頂層要往下再走一層 */
  isRootPerspective: boolean;
  orgId: string | null;
}

/**
 * 「上層組織」下拉可以選誰(搬移,`docs/modules/org-manager.md`「搬移」)。
 * 候選 = **管理範圍內、同租戶、不在自己這棵子樹裡**;三條全在前端先擋掉,
 * api 仍會再驗一次(範圍外 `NOT_FOUND`、跨租戶 `CROSS_TENANT`、成環 `CYCLIC_MOVE`)。
 *
 * 1. **管理範圍**:樹上有的就是管理範圍(#187:範圍外的組織根本不回傳),所以只要在樹上走
 * 2. **同一個租戶**:租戶頂層是根組織視角的第 2 個、其餘視角的第 1 個。
 *    管理範圍可能有多個頂點(#187),`orgTrail` 會找出含自己的那一棵,`trail[0]` 就是它的根;
 *    根組織視角只會有一棵樹(管理範圍是全部 → 樹根就是平台根組織),所以這個位移只有一種。
 *    非根組織視角的樹根本來就在單一租戶內,樹根即上限
 * 3. **不能搬進自己的子樹**(含自己)— 會把樹接成環
 *
 * 租戶頂層自己的候選是空的(整棵子樹都被排除)= 搬不動,與 api 的租戶頂層保護一致。
 */
export const useMoveTargets = ({
  nodes,
  isRootPerspective,
  orgId,
}: UseMoveTargetsOptions): OrgOption[] =>
  useMemo(() => {
    if (orgId === null) {
      return [];
    }
    const self = findOrgNode(nodes, orgId);
    const trail = orgTrail(nodes, orgId);
    const tenantTopDepth = isRootPerspective ? 1 : 0;
    if (self === null || trail.length <= tenantTopDepth) {
      return [];
    }
    const tenantTop = trail[tenantTopDepth];
    const forbidden = new Set(flattenOrgs([self]).map((org) => org.id));
    return flattenOrgs([tenantTop]).filter(
      (option) => !forbidden.has(option.id) && !option.outOfScope,
    );
  }, [nodes, isRootPerspective, orgId]);
