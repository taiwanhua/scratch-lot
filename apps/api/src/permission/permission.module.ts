import { Global, Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { ForeignFormPermissions } from "./foreign-form-permissions";
import { MeModulesResolver } from "./me-modules.resolver";
import { PermissionResolver } from "./permission-resolver";

/**
 * 登入線2(#63):PermissionResolver(ADR-0011 七步)+ `me.modules`。
 * 標 @Global:`@RequirePermission` 以 UseGuards 掛在各功能模組的 resolver 上,
 * 其 guard 的依賴(PermissionResolver)要能從任何模組解析,不必每個功能模組都 import 本模組。
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [PermissionResolver, ForeignFormPermissions, MeModulesResolver],
  exports: [PermissionResolver, ForeignFormPermissions],
})
export class PermissionModule {}
