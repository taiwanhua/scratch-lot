import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { DatabaseModule } from "../database/database.module";
import { FieldCategoryOptionsService } from "./field-category-options.service";
import { FormAccessService } from "./form-access.service";
import { FormUserNames } from "./form-mapper";
import { SubmissionValuesService } from "./form-values/submission-values.service";
import { LookupProvidersService } from "./lookup-providers";
import { MeOrgTimezoneResolver } from "./me-org-timezone.resolver";

/**
 * 表單引擎的共用零件(設計端 `FormDesignModule` 與執行端 `FormRuntimeModule` 都用):
 * 可見 / 可改 / 可新增的判準、lookup 登錄表(含專案登記的來源)、欄位管理類別選項、提交值的寫入規則、使用者名稱。
 * 權限解析與稽核由 @Global 的 PermissionModule / AuditModule 提供。
 */
@Module({
  // DiscoveryModule:lookup 登錄表啟動時收集專案以 `LOOKUP_PROVIDER` 登記的來源
  imports: [DatabaseModule, DiscoveryModule],
  providers: [
    FormAccessService,
    FieldCategoryOptionsService,
    LookupProvidersService,
    SubmissionValuesService,
    FormUserNames,
    MeOrgTimezoneResolver,
  ],
  exports: [
    FormAccessService,
    FieldCategoryOptionsService,
    LookupProvidersService,
    SubmissionValuesService,
    FormUserNames,
  ],
})
export class FormsCoreModule {}
