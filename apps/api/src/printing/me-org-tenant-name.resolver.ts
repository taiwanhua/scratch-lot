import { Parent, ResolveField, Resolver } from "@nestjs/graphql";
import { Types } from "mongoose";

import { CurrentOperator } from "../auth/decorators";
import { MeOrg } from "../auth/models/me.model";
import { OrgsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { tenantIdOfOrg } from "../database/tenant-id";

/**
 * `me.currentOrg.tenantName`:讀者當前組織所屬的**最上層組織名稱**(租戶頂層的名稱;根組織 = 根組織自己的名稱)。
 * 單據(58mm)上方印的租戶名稱用它(印租戶名稱、不印分店名稱),
 * 印表機管理的測試頁是第一個使用處。
 *
 * 同 `me.currentOrg.timezone`(`forms/me-org-timezone.resolver.ts`)的讀法:租戶頂層是租戶的設定,
 * 不受操作者的管理範圍限制(分店層級的使用者也要印得出租戶名稱)。以 field resolver 掛在 `MeOrg` 上,
 * 只有客戶端問才查;讀不到時退回當前組織自己的名稱。
 */
@Resolver(() => MeOrg)
export class MeOrgTenantNameResolver {
  constructor(private readonly orgs: OrgsRepository) {}

  @ResolveField(() => String)
  async tenantName(
    @Parent() org: MeOrg,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<string> {
    const reader: OperatorContext = {
      ...operator,
      visibleOrgIds: "all",
      managedOrgIds: "all",
    };
    const current = await this.orgs.findById(
      reader,
      new Types.ObjectId(org.id),
    );
    if (!current) {
      return org.name;
    }
    const tenantId = tenantIdOfOrg({
      _id: current._id,
      ancestors: current.ancestors,
    });
    if (tenantId === null || tenantId.equals(current._id)) {
      return current.name;
    }
    const tenant = await this.orgs.findById(reader, tenantId);
    return tenant?.name ?? current.name;
  }
}
