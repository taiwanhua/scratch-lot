import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OrgsModule } from "../orgs/orgs.module";
import { WorkflowEngineModule } from "../workflows/workflow-engine/workflow-engine.module";
import { OrgQualificationService } from "./org-qualification.service";
import { UserGrantRulesService } from "./user-grant-rules.service";
import { UsersResolver } from "./users.resolver";
import { UsersService } from "./users.service";

/**
 * 使用者管理(`system.user-manager`)。
 * 需要 AuthModule 匯出的 `AuthService`(停用時作廢 refresh token)與
 * `PasswordService`(啟用信),以及 OrgsModule 匯出的 `OwnerProtectionService`
 * (擁有者保護,住在 `orgs/` — 判斷主體是組織);
 * 稽核與權限解析分別由 @Global 的 AuditModule / PermissionModule 提供。
 */
@Module({
  // 停用 / 移出租戶時的審核者失效 hook(`AssigneeInvalidationService`)
  imports: [DatabaseModule, AuthModule, OrgsModule, WorkflowEngineModule],
  providers: [
    UsersService,
    UsersResolver,
    OrgQualificationService,
    UserGrantRulesService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
