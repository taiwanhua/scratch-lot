import type { Types } from "mongoose";

import type { OperatorContext } from "../../database/operator-context";

/** 操作者所在租戶(當前組織的租戶頂層)。 */
export interface OperatorTenant {
  /** 租戶 id;根組織為 null。 */
  tenantId: Types.ObjectId | null;
}

/**
 * 依當前組織算出租戶(不讀資料庫:登入線算好的 `memberTenants` 已依租戶分組所屬組織)。
 * 當前組織是根組織 → `tenantId = null`;沒有當前組織(系統上下文)→ null(呼叫端視為沒有資料)。
 */
export function tenantOfOperator(
  operator: OperatorContext,
): OperatorTenant | null {
  const current = operator.currentOrgId;
  if (current === null) {
    return null;
  }
  const tenant = operator.memberTenants.find((group) =>
    group.memberOrgIds.some((id) => id.equals(current)),
  );
  if (tenant) {
    return { tenantId: tenant.tenantId };
  }
  // 不屬於任何租戶的當前組織只剩根組織(根組織成員的可見範圍是全部)
  return operator.visibleOrgIds === "all" ? { tenantId: null } : null;
}
