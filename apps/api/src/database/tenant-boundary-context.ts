import type { Types } from "mongoose";

import type { OrgsRepository } from "./database.module";
import type { OperatorContext } from "./operator-context";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import { systemTenantReader } from "./system-tenant-reader";
import type { TenantBoundaryContextPurpose } from "./tenant-boundary-purposes";

/**
 * **租戶邊界上下文**(ADR-0005「例外出口」):可見範圍與管理範圍 = 這個租戶的整棵組織樹,
 * 給「問的是整個租戶」的讀(反查、以人為準的資料)、登記過的例外寫入與排程。
 *
 * - 有操作者:`tenantId` 必須是他所屬的租戶(`memberTenants`;根組織成員除外),否則 `TenantScopeError`;
 *   回傳的上下文保留他的 `actorId`(基礎欄位與稽核記得是誰),其餘照租戶系統身分
 * - 沒有操作者(排程、系統重算):等同 `systemTenantReader(tenantId)`
 * - `tenantId = null`(根組織的資料,沒有租戶):只有根組織成員可用,直接回他自己的上下文(本來就看得到全部)
 *
 * **不要把提升上下文(可見範圍寫成 `"all"` 的上下文)傳進來**:可見範圍是全部的操作者會被當成根組織成員,
 * 不檢查租戶就放行。只傳登入線算出的操作者上下文,或 `null`(排程 / 系統重算)。
 *
 * 前提:用它讀寫的表**不是資料範圍目標**(系統身分沒有角色,對全員生效的規則照樣收窄,ADR-0008)。
 * 呼叫端登記在 `TENANT_BOUNDARY_CONTEXT_CALLERS`(附用途),`tenant-boundary-context.test.ts` 依 import 來源
 * 掃 src 鎖定;`system-tenant-reader` 只准由這個檔 import。
 */
export async function tenantBoundaryContext(
  orgs: OrgsRepository,
  operator: OperatorContext | null,
  tenantId: Types.ObjectId | null,
): Promise<OperatorContext> {
  const isRoot = operator !== null && operator.visibleOrgIds === "all";
  if (tenantId === null) {
    if (operator !== null && isRoot) {
      return operator;
    }
    throw new TenantScopeError(
      "tenantBoundaryContext:沒有租戶的資料只有根組織可用",
    );
  }
  if (
    operator !== null &&
    !isRoot &&
    !operator.memberTenants.some((tenant) => tenant.tenantId.equals(tenantId))
  ) {
    throw new TenantScopeError(
      `tenantBoundaryContext:${String(tenantId)} 不是操作者所屬的租戶`,
    );
  }
  const reader = await systemTenantReader(orgs, tenantId);
  return operator === null ? reader : { ...reader, actorId: operator.actorId };
}

export type { TenantBoundaryContextPurpose } from "./tenant-boundary-purposes";

/**
 * **允許呼叫 `tenantBoundaryContext` 的底座檔案**(相對 `apps/api/src/`)與用途。專案的呼叫端登記在
 * 專案入口 `project/database/tenant-boundary-callers.ts`,不改這份。新增前先在 ADR-0005「例外出口」那一列確認用途;
 * `tenant-boundary-context.test.ts` 合併兩份清單掃 src 斷言。
 */
export const TENANT_BOUNDARY_CONTEXT_CALLERS: Readonly<
  Record<string, readonly TenantBoundaryContextPurpose[]>
> = {};
