import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { OrgsModule } from "../orgs/orgs.module";
import { OrgQualificationService } from "../users/org-qualification.service";
import { RoleMatrixService } from "./role-matrix.service";
import { RoleScopeService } from "./role-scope.service";
import { RoleUsersService } from "./role-users.service";
import { RolesResolver } from "./roles.resolver";
import { RolesService } from "./roles.service";

/**
 * 角色管理(`system.role-manager`;規則正本 docs/modules/role-manager.md)。
 *
 * `OrgsModule` 匯出的 `OwnerProtectionService`(擁有者保護,ADR-0009)與 `DeletePayload` 型別;
 * `OrgQualificationService`(「被授予角色的資格」,ADR-0003)住在 `users/`,
 * 是無狀態的純判斷,這裡直接註冊一份 provider — 不去改 `UsersModule` 的匯出,
 * 也不在本模組另寫一份同語意的函式(issue-tracker.md 的拆票教訓)。
 * 稽核與權限解析由 @Global 的 AuditModule / PermissionModule 提供,不必在此 import。
 */
@Module({
  imports: [DatabaseModule, OrgsModule],
  providers: [
    RolesService,
    RoleScopeService,
    RoleMatrixService,
    RoleUsersService,
    RolesResolver,
    OrgQualificationService,
  ],
  exports: [RolesService, RoleMatrixService],
})
export class RolesModule {}
