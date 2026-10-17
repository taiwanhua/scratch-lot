import { ID, Parent, ResolveField, Resolver } from "@nestjs/graphql";
import { Types } from "mongoose";

import { CurrentOperator } from "../auth/decorators";
import { MeOrg } from "../auth/models/me.model";
import type { OperatorContext } from "../database/operator-context";
import { FormAccessService } from "./form-access.service";

/**
 * `me.currentOrg.timezone`:讀者當前組織的**租戶時區**(租戶頂層的 `orgs.settings.timezone`,
 * 沒設 = `Asia/Taipei`;根組織讀根組織的設定;`database/tenant-timezone.ts`)。
 * 日期 / 日期時間的輸入與顯示**一律**用它 —— 草稿、詳情、修訂紀錄都一樣,已送出修訂的 `ctx.timezone`
 * 只用於重算條件,不決定顯示;資料範圍規則編輯器把選的那一天換成時點也用它。
 * 以 field resolver 掛在 `MeOrg` 上(先例:`storage/me-org-logo.resolver.ts`),只有客戶端問才查;
 * 同一處另掛 `tenantId`(表達式的 `ctx.tenant.id`)。
 */
@Resolver(() => MeOrg)
export class MeOrgTimezoneResolver {
  constructor(private readonly access: FormAccessService) {}

  @ResolveField(() => String)
  timezone(
    @Parent() org: MeOrg,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<string> {
    return this.access.timezoneOfOrg(operator, new Types.ObjectId(org.id));
  }

  /**
   * `me.currentOrg.tenantId`:這個組織所屬的租戶頂層 id(根組織 = null)。填寫中的表達式 `ctx.tenant.id`
   * 用它(送出時以後端快照為準)。
   */
  @ResolveField(() => ID, { nullable: true })
  async tenantId(
    @Parent() org: MeOrg,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<string | null> {
    const tenantId = await this.access.tenantIdOfOrg(
      operator,
      new Types.ObjectId(org.id),
    );
    return tenantId === null ? null : String(tenantId);
  }
}
