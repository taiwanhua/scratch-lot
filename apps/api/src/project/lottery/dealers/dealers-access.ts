import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { LocalDate } from "@repo/domain/form";

import { authError } from "../../../auth/auth-error";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantIdOfOrg } from "../../../database/tenant-id";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";
import { localDayOf } from "./dealer-dates";
import { DEALERS_KEY } from "./dealer-keys";

/** 一次解析好的「這位操作者在經銷商管理能做什麼、站在哪個租戶、今天是哪天」。 */
export interface DealersGrant {
  has: (permissionKey: string) => boolean;
  /** 當前組織的租戶頂層;根組織為 null。 */
  tenantId: Types.ObjectId | null;
  timezone: string;
  /** 租戶時區的今天。 */
  today: LocalDate;
}

/**
 * 讀租戶範圍(跨可見範圍)用的上下文:兩個範圍提升為 `"all"`(先例 `fields/field-visibility.ts`)。
 *
 * **只准搭配把查詢釘在 `tenantId` 上的條件**:租戶內唯一(證號、身分證字號)與「對應分店是否已被占用」
 * 問的是整個租戶,不是操作者看得到的那一部分。
 */
export function tenantWideReader(operator: OperatorContext): OperatorContext {
  return { ...operator, visibleOrgIds: "all", managedOrgIds: "all" };
}

/**
 * 經銷商管理的讀取守門:規格 3.2 的 `dealers` 沒有 `view` 權限,**讀取看模組有沒有綁**
 * (ADR-0011「進得去哪一頁 = me.modules 有沒有那個模組」;先例檔案管理)。
 * 關係人的資料也以 `dealers` 為準(經銷商的表單與詳情要顯示關係人);關係人分頁另看 `dealers.contacts`。
 */
@Injectable()
export class DealersAccess {
  constructor(
    private readonly permissions: PermissionResolver,
    private readonly orgs: OrgsRepository,
  ) {}

  async grantOf(
    operator: OperatorContext,
    now: Date = new Date(),
  ): Promise<DealersGrant & { modules: ReadonlySet<string> }> {
    const resolution =
      operator.actorId === null
        ? null
        : await this.permissions.resolve(
            operator.actorId,
            operator.currentOrgId,
          );
    const org =
      operator.currentOrgId === null
        ? null
        : await this.orgs.findById(
            tenantWideReader(operator),
            operator.currentOrgId,
          );
    const tenantId = org === null ? null : tenantIdOfOrg(org);
    const timezone = await tenantTimezoneOf(this.orgs, operator, tenantId);
    return {
      modules: new Set(resolution?.modules.map((module) => module.key)),
      has: (key) => resolution !== null && holdsPermission(resolution, key),
      tenantId,
      timezone,
      today: localDayOf(now, timezone),
    };
  }

  /** 沒綁 `dealers` → `FORBIDDEN`(與 `@RequirePermission` 同一個碼)。 */
  async assertReadable(
    operator: OperatorContext,
    now?: Date,
  ): Promise<DealersGrant> {
    const grant = await this.grantOf(operator, now);
    if (!grant.modules.has(DEALERS_KEY)) {
      throw authError("FORBIDDEN", `Missing module ${DEALERS_KEY}`);
    }
    return grant;
  }
}
