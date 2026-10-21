import { Injectable } from "@nestjs/common";

import { authError } from "../../auth/auth-error";
import type { OperatorContext } from "../../database/operator-context";
import {
  PermissionResolver,
  holdsPermission,
} from "../../permission/permission-resolver";

/** 操作者此刻綁到的模組與持有的權限(一次解析,service 內多處判斷共用)。 */
export interface MasterDataGrant {
  hasModule: (moduleKey: string) => boolean;
  has: (permissionKey: string) => boolean;
}

const NO_GRANT: MasterDataGrant = {
  hasModule: () => false,
  has: () => false,
};

/**
 * 檔案管理的讀取守門:規格 3.2 的 `master-data` 沒有 `view` 權限,**讀取看模組有沒有綁**
 * (ADR-0011「進得去哪一頁 = me.modules 有沒有那個模組」):遊戲分頁 = `master-data.games`、
 * 收銀點分頁 = `master-data.cash-points`(兩個權限容器兼分頁的進入條件)。寫入照常用 `@RequirePermission`。
 */
@Injectable()
export class MasterDataAccess {
  constructor(private readonly permissions: PermissionResolver) {}

  async grantOf(operator: OperatorContext): Promise<MasterDataGrant> {
    if (!operator.actorId) {
      return NO_GRANT;
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    const moduleKeys = new Set(resolution.modules.map((module) => module.key));
    return {
      hasModule: (moduleKey) => moduleKey !== "" && moduleKeys.has(moduleKey),
      has: (permissionKey) => holdsPermission(resolution, permissionKey),
    };
  }

  /** 沒綁該模組 → `FORBIDDEN`(與 `@RequirePermission` 同一個碼)。 */
  async assertModule(
    operator: OperatorContext,
    moduleKey: string,
  ): Promise<MasterDataGrant> {
    const grant = await this.grantOf(operator);
    if (!grant.hasModule(moduleKey)) {
      throw authError("FORBIDDEN", `Missing module ${moduleKey}`);
    }
    return grant;
  }
}
