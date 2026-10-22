import { Injectable } from "@nestjs/common";

import { STORE_PERMISSIONS } from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";
import { forbiddenError } from "./store-error";

/** 操作者此刻在店面管理能做什麼(一次解析,service 內多處判斷共用)。 */
export interface StoreGrant {
  has: (permissionKey: string) => boolean;
}

/**
 * 店面管理的守門:讀取要 `store.view`;寫入的頁內權限由 resolver 的 `@RequirePermission` 守,
 * 「負責人或店長」這類依資料而定的判斷在 service 用這裡的 `grantOf`。
 *
 * **店長**:規格 6.2 / 6.6「只有這一班的負責人或店長」沒有對應的權限;角色是租戶資料、不能用名稱判斷,
 * 以持有 `store.edit`(店面管理的「編輯」)代表店長(開通時建立的角色只有總部管理、店長有,店員沒有)。
 */
@Injectable()
export class StoreAccess {
  constructor(private readonly permissions: PermissionResolver) {}

  async grantOf(operator: OperatorContext): Promise<StoreGrant> {
    const resolution =
      operator.actorId === null
        ? null
        : await this.permissions.resolve(
            operator.actorId,
            operator.currentOrgId,
          );
    return {
      has: (key) => resolution !== null && holdsPermission(resolution, key),
    };
  }

  /** 沒有 `store.view` → `FORBIDDEN`。 */
  async assertView(operator: OperatorContext): Promise<StoreGrant> {
    const grant = await this.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.view)) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.view}`);
    }
    return grant;
  }
}

/** 店長(見 `StoreAccess` 說明):持有 `store.edit`。 */
export function isStoreManager(grant: StoreGrant): boolean {
  return grant.has(STORE_PERMISSIONS.edit);
}
