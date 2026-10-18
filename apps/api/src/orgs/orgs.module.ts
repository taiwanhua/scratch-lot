import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { StorageModule } from "../storage/storage.module";
import { OrgManagersService } from "./org-managers.service";
import { OrgsResolver } from "./orgs.resolver";
import { OrgsService } from "./orgs.service";
import { OwnerProtectionService } from "./owner-protection.service";
import { TenantOpsResolver } from "./tenant-ops.resolver";
import { TenantOpsService } from "./tenant-ops.service";

/**
 * 組織管理(`system.org-manager`,docs/modules/org-manager.md):樹查詢、新增子組織、編輯、
 * 停用 / 啟用連動、搬移、刪除前置,以及租戶作業(`tenant-ops`):
 * 開通租戶 / 轉移擁有者 / 設定可見範圍。
 *
 * `AuthModule` 是為了開通時寄啟用信(`PasswordService.sendActivationEmail`)。
 * `OwnerProtectionService` 住在這裡、對外匯出:判斷的主體是組織(`ownerUserId`、根組織例外),
 * 使用者管理與租戶作業共用同一個判斷點。
 * AuditService / PermissionResolver 由 @Global 的 AuditModule / PermissionModule 提供,不必在此 import。
 */
@Module({
  imports: [DatabaseModule, StorageModule, AuthModule],
  providers: [
    OrgsService,
    OrgManagersService,
    OrgsResolver,
    OwnerProtectionService,
    TenantOpsService,
    TenantOpsResolver,
  ],
  exports: [OrgsService, OrgManagersService, OwnerProtectionService],
})
export class OrgsModule {}
