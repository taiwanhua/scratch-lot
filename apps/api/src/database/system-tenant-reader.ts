import type { Types } from "mongoose";

import type { OrgsRepository } from "./database.module";
import type { OperatorContext } from "./operator-context";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import { assertTenantBoundary } from "./tenant-boundary";

/**
 * 讀組織樹用的系統上下文:要列出整個租戶的組織,當下還沒有範圍可用(同登入線的 `systemOperator`)。
 * 只在本檔內使用,查詢條件固定釘在「該租戶頂層與它的下層」。
 */
function orgTreeReader(): OperatorContext {
  return {
    actorId: null,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
    memberTenants: [],
  };
}

/**
 * **排程用的租戶系統身分**(ADR-0005「例外出口」):沒有操作者、不帶角色,可見範圍與管理範圍
 * = **這個租戶的整棵組織樹**(租戶頂層 + 全部下層),不會碰到別的租戶。
 * 排程任務逐租戶跑時用它,取代「提升成 `"all"` 再自己釘 `tenantId`」的寫法。
 *
 * - `tenantId` 必填且必須是租戶頂層(`ancestors` 只有根組織);不是 → `TenantScopeError`
 * - 以租戶頂層為所屬組織與當前組織(資料範圍規則的「指定組織」以它比對,同
 *   `OperatorContextService.systemOperatorOfOrg`);沒有角色,對全員生效的規則照樣收窄(ADR-0008)
 */
export async function systemTenantReader(
  orgs: OrgsRepository,
  tenantId: Types.ObjectId | null | undefined,
): Promise<OperatorContext> {
  const boundary = assertTenantBoundary(tenantId, "systemTenantReader");
  const reader = orgTreeReader();
  const top = await orgs.findById(reader, boundary);
  if (top?.ancestors.length !== 1) {
    throw new TenantScopeError(
      `systemTenantReader:${String(boundary)} 不是租戶頂層`,
    );
  }
  const descendants = await orgs.findMany(
    reader,
    { ancestors: boundary },
    { select: "_id" },
  );
  const orgIds = [top._id, ...descendants.map((org) => org._id)];
  return {
    actorId: null,
    currentOrgId: top._id,
    visibleOrgIds: orgIds,
    managedOrgIds: orgIds,
    memberOrgIds: [top._id],
    roleIds: [],
    memberTenants: [
      { tenantId: top._id, memberOrgIds: [top._id], ancestorOrgIds: [] },
    ],
  };
}
