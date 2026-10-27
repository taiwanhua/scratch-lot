import { Injectable } from "@nestjs/common";

import {
  INVENTORY_KEY,
  INVENTORY_PERMISSIONS,
} from "@repo/domain/project/lottery";

import { authError } from "../../../auth/auth-error";
import type { OperatorContext } from "../../../database/operator-context";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";

/** 操作者此刻在庫存管理能做什麼(一次解析,service 內多處判斷共用)。 */
export interface InventoryGrant {
  has: (permissionKey: string) => boolean;
  canShowCost: boolean;
}

/**
 * 庫存管理的守門:規格 3.2 的 `inventory` 沒有 `view`,**讀取看模組有沒有綁**(ADR-0011);
 * 遊戲詳情、乙類詳情的「預計要給本數」「庫存概況 / 在店庫存」讀同一份資料,守門相同。
 * 寫入另用 `@RequirePermission`(`mark-skipped` / `recover` / `scrap` / `edit-allocations`)。
 */
@Injectable()
export class InventoryAccess {
  constructor(private readonly permissions: PermissionResolver) {}

  /** 沒綁庫存管理 → `FORBIDDEN`(與 `@RequirePermission` 同一個碼)。 */
  async assertModule(operator: OperatorContext): Promise<InventoryGrant> {
    const resolution =
      operator.actorId === null
        ? null
        : await this.permissions.resolve(
            operator.actorId,
            operator.currentOrgId,
          );
    if (!resolution?.modules.some((module) => module.key === INVENTORY_KEY)) {
      throw authError("FORBIDDEN", `Missing module ${INVENTORY_KEY}`);
    }
    const has = (key: string) => holdsPermission(resolution, key);
    return { has, canShowCost: has(INVENTORY_PERMISSIONS.showCost) };
  }

  /** 寫入:只看權限(尋回也從店面的刷條碼提示呼叫,不要求綁庫存管理頁)。 */
  async grantOf(operator: OperatorContext): Promise<InventoryGrant> {
    const resolution =
      operator.actorId === null
        ? null
        : await this.permissions.resolve(
            operator.actorId,
            operator.currentOrgId,
          );
    const has = (key: string) =>
      resolution !== null && holdsPermission(resolution, key);
    return { has, canShowCost: has(INVENTORY_PERMISSIONS.showCost) };
  }
}
