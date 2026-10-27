import type { Types } from "mongoose";

import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";

/** 租戶裡的一個組織(分店清單、子樹)。 */
export interface TenantOrg {
  id: Types.ObjectId;
  name: string;
  parentId: Types.ObjectId | null;
  ancestors: Types.ObjectId[];
}

/**
 * **店**的認定(唯一一份;分店清單與「尋回回到哪家店」共用):租戶裡**沒有下層組織**的組織。
 * 租戶只有最上層組織一個時,它自己就是店。
 */
export function isStoreOrg(
  org: Pick<TenantOrg, "id">,
  tenantOrgs: readonly Pick<TenantOrg, "parentId">[],
): boolean {
  return !tenantOrgs.some((other) => other.parentId?.equals(org.id) === true);
}

/** 操作者看得到的店(`isStoreOrg` + 可見範圍)。 */
export function isVisibleStore(
  operator: OperatorContext,
  org: Pick<TenantOrg, "id">,
  tenantOrgs: readonly Pick<TenantOrg, "parentId">[],
): boolean {
  return isOrgVisible(operator, org.id) && isStoreOrg(org, tenantOrgs);
}
