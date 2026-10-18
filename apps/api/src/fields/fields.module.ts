import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { OrgsModule } from "../orgs/orgs.module";
import { FieldCategoriesResolver } from "./field-categories.resolver";
import { FieldCategoriesService } from "./field-categories.service";
import { FieldsResolver } from "./fields.resolver";
import { FieldsService } from "./fields.service";

/**
 * 欄位管理(`system.field-manager`):選項(`FieldsService`)與類別(`FieldCategoriesService`)。
 * import `OrgsModule` 是為了 `OwnerProtectionService.isRootOperator` —— 類別作業是根組織專屬,
 * 判斷點與租戶作業共用一個,不在此另寫一套。
 * 稽核與權限解析分別由 @Global 的 AuditModule / PermissionModule 提供。
 */
@Module({
  imports: [DatabaseModule, OrgsModule],
  providers: [
    FieldsService,
    FieldsResolver,
    FieldCategoriesService,
    FieldCategoriesResolver,
  ],
  exports: [FieldsService],
})
export class FieldsModule {}
