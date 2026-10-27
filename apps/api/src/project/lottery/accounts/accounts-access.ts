import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { authError } from "../../../auth/auth-error";
import type { OperatorContext } from "../../../database/operator-context";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";
import { tenantOfOperator } from "../master-data-tenant";

/** 一次解析好的「這位操作者在帳戶管理能做什麼、站在哪個租戶」。 */
export interface AccountsGrant {
  has: (permissionKey: string) => boolean;
  /** 當前組織的租戶頂層;根組織為 null。 */
  tenantId: Types.ObjectId | null;
}

/**
 * 帳戶管理的讀寫守門:規格 3.2 的 `accounts` 沒有 `view`,分頁各自一條 `view-*` 權限
 * (`view-bank-accounts` / `view-cash` / `view-outstanding`);寫入另看 `create-` / `edit-` /
 * `record-` / `reverse-`;收付按鈕沿用單據的權限(`settle` / `pay` / `receive`)。
 */
@Injectable()
export class AccountsAccess {
  constructor(private readonly permissions: PermissionResolver) {}

  async grantOf(operator: OperatorContext): Promise<AccountsGrant> {
    const resolution =
      operator.actorId === null
        ? null
        : await this.permissions.resolve(
            operator.actorId,
            operator.currentOrgId,
          );
    return {
      has: (key) => resolution !== null && holdsPermission(resolution, key),
      tenantId: tenantOfOperator(operator)?.tenantId ?? null,
    };
  }

  /** 沒有這條權限 → `FORBIDDEN`(與 `@RequirePermission` 同一個碼)。 */
  async assert(
    operator: OperatorContext,
    permissionKey: string,
  ): Promise<AccountsGrant> {
    const grant = await this.grantOf(operator);
    if (!grant.has(permissionKey)) {
      throw authError("FORBIDDEN", `Missing permission ${permissionKey}`);
    }
    return grant;
  }
}
