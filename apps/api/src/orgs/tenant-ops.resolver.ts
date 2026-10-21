import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import { DemoTenantPurgeService } from "./demo-tenant-purge.service";
import { ProvisionTenantInput } from "./dto/provision-tenant.input";
import { PurgeDemoTenantInput } from "./dto/purge-demo-tenant.input";
import { RevokeTenantProvisionInput } from "./dto/revoke-tenant-provision.input";
import { TransferOrgOwnerInput } from "./dto/transfer-org-owner.input";
import { OrgPayload } from "./models/org-payloads.model";
import {
  ModuleOption,
  ProvisionTarget,
  ProvisionTenantPayload,
  PurgeDemoTenantPayload,
  RevokeTenantProvisionPayload,
} from "./models/tenant-ops.model";
import { TenantOpsService } from "./tenant-ops.service";

/**
 * 權限 key(docs/modules/org-manager.md 權限表;種子 apps/db-migrator/seeds/base/modules/system.ts)。
 * 兩筆都屬 `system.org-manager.tenant-ops` — 一個 `isRootOnly` 的隱藏模組,
 * 租戶管理員模板複製時整個模組被扣除,所以租戶永遠拿不到(ADR-0009 第 3 步)。
 * (可見範圍開關 2026-09-19 搬到組織管理層 `system.org-manager.set-visibility`:
 * 它是租戶自己的資料政策,不是根組織專屬動作。)
 */
const PERMISSIONS = {
  provision: "system.org-manager.tenant-ops.provision",
  revokeProvision: "system.org-manager.tenant-ops.revoke-provision",
  purgeDemo: "system.org-manager.tenant-ops.purge-demo",
  transferOwner: "system.org-manager.tenant-ops.transfer-owner",
} as const;

/**
 * 租戶作業的 GraphQL 端點(彈窗開在組織管理頁上,但權限屬 tenant-ops)。
 * resolver 薄:守門交給 `@RequirePermission`,「必須站在根組織」與全部規則在 TenantOpsService。
 */
@Resolver()
export class TenantOpsResolver {
  constructor(
    private readonly tenantOps: TenantOpsService,
    private readonly demoPurge: DemoTenantPurgeService,
  ) {}

  /** 開通彈窗的模組勾選清單(= 租戶管理員模板綁的模組;前端預設全勾)。 */
  @RequirePermission(PERMISSIONS.provision)
  @Query(() => [ModuleOption])
  tenantModuleOptions(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ModuleOption[]> {
    return this.tenantOps.moduleOptions(operator);
  }

  /** 開通的寫入目標:這個 api 連到的資料庫名(demo 指令比對確認字串用;根組織專屬)。 */
  @RequirePermission(PERMISSIONS.provision)
  @Query(() => ProvisionTarget)
  provisionTarget(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ProvisionTarget> {
    return this.tenantOps.provisionTarget(operator);
  }

  /** 開通租戶:ADR-0009 四步 + 擁有者是一個交易(失敗全部回復),啟用信在交易提交後寄。 */
  @RequirePermission(PERMISSIONS.provision)
  @Mutation(() => ProvisionTenantPayload)
  provisionTenant(
    @Args("input") input: ProvisionTenantInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ProvisionTenantPayload> {
    return this.tenantOps.provision(operator, input);
  }

  /**
   * 撤銷開通:反向抹掉開通建出的三樣,只在租戶底下沒有其他資料時才允許。
   * 權限與 `provision` 同屬 `tenant-ops`(`isRootOnly` 模組),另立一筆 key —
   * 開通與撤銷是兩個風險等級不同的動作,不共用同一筆權限。
   */
  @RequirePermission(PERMISSIONS.revokeProvision)
  @Mutation(() => RevokeTenantProvisionPayload)
  revokeTenantProvision(
    @Args("input") input: RevokeTenantProvisionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RevokeTenantProvisionPayload> {
    return this.tenantOps.revokeProvision(operator, input);
  }

  /**
   * 清空示範機構(demo 指令 `purge` / `rebuild`):只接受標「示範」的租戶頂層,刪掉它的全部資料
   * (含只能新增的帳本)、只屬於它的使用者與它引用的檔案(`DemoTenantPurgeService`)。
   * 一個租戶作業一筆權限(`tenant-ops.purge-demo`,根組織專屬);
   * 只對「示範」機構生效由服務層擋(沒有標記 → `FORBIDDEN`,一筆都不刪)。
   */
  @RequirePermission(PERMISSIONS.purgeDemo)
  @Mutation(() => PurgeDemoTenantPayload)
  purgeDemoTenant(
    @Args("input") input: PurgeDemoTenantInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PurgeDemoTenantPayload> {
    return this.demoPurge.purge(operator, input.slug);
  }

  @RequirePermission(PERMISSIONS.transferOwner)
  @Mutation(() => OrgPayload)
  async transferOrgOwner(
    @Args("input") input: TransferOrgOwnerInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgPayload> {
    return { org: await this.tenantOps.transferOwner(operator, input) };
  }
}
