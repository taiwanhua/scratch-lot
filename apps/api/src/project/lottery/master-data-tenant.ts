import type { Types } from "mongoose";

import type { OrgsRepository } from "../../database/database.module";
import type { OperatorContext } from "../../database/operator-context";
import { tenantIdOfOrg } from "../../database/tenant-id";

/** 操作者所在租戶(當前組織的租戶頂層)。 */
export interface OperatorTenant {
  /** 租戶 id;根組織為 null。 */
  tenantId: Types.ObjectId | null;
  /** 租戶共用主檔(遊戲)的擁有組織 = 租戶頂層;根組織 = 根組織自己。 */
  ownerOrgId: Types.ObjectId;
}

/**
 * 租戶共用主檔的讀寫上下文:兩個範圍提升為 `"all"`(先例 `fields/field-visibility.ts` 的
 * `fieldReadContext`)。分店人員的可見範圍不含上層,看不到掛在租戶頂層的遊戲,所以要提升。
 *
 * **只准搭配把查詢釘在 `tenantId`(或已釘住的 `_id`)上的條件**:範圍由 `tenantOfOperator` 算出,
 * 提升的只是「資料層不要再以可見範圍濾一次」。
 */
export function tenantReadContext(operator: OperatorContext): OperatorContext {
  return { ...operator, visibleOrgIds: "all", managedOrgIds: "all" };
}

/** 依當前組織算出租戶;沒有當前組織或讀不到組織 → null(呼叫端視為沒有資料)。 */
export async function tenantOfOperator(
  operator: OperatorContext,
  orgs: OrgsRepository,
): Promise<OperatorTenant | null> {
  if (operator.currentOrgId === null) {
    return null;
  }
  const org = await orgs.findById(
    tenantReadContext(operator),
    operator.currentOrgId,
  );
  if (!org) {
    return null;
  }
  const tenantId = tenantIdOfOrg(org);
  return { tenantId, ownerOrgId: tenantId ?? org._id };
}
