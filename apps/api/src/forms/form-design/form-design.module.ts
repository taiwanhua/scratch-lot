import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { FormsCoreModule } from "../forms-core.module";
import { FormDefinitionChecker } from "./form-definition-checker";
import { FormFieldPermissionsService } from "./form-field-permissions.service";
import { FormPublishHooks } from "./form-publish-hooks";
import { FormPublishService } from "./form-publish.service";
import { FormSeedExportService } from "./form-seed-export.service";
import { FormVersionsResolver } from "./form-versions.resolver";
import { FormVersionsService } from "./form-versions.service";
import { FormsResolver } from "./forms.resolver";
import { FormsService } from "./forms.service";
import { LookupProvidersResolver } from "./lookup-providers.resolver";
import { ModuleListColumnsResolver } from "./module-list-columns.resolver";
import { ModuleListColumnsService } from "./module-list-columns.service";
import { RetiredPermissionsResolver } from "./retired-permissions.resolver";
import { SeedExportCatalogService } from "./seed-export-catalog.service";

/**
 * 表單設計(`docs/modules/forms.md`):表單、版本、四步發布與重試、分派 / 啟用、
 * 欄位級權限的產生與退役清理、表單模組的列表欄位配置、設計器的 lookup 來源清單。
 */
@Module({
  imports: [DatabaseModule, FormsCoreModule],
  providers: [
    FormDefinitionChecker,
    FormFieldPermissionsService,
    FormPublishHooks,
    FormPublishService,
    FormSeedExportService,
    FormVersionsService,
    FormsService,
    FormsResolver,
    FormVersionsResolver,
    RetiredPermissionsResolver,
    LookupProvidersResolver,
    ModuleListColumnsService,
    ModuleListColumnsResolver,
    SeedExportCatalogService,
  ],
  // 流程綁定(`workflows/workflow-design/`)回傳表單管理的 `FormPayload`,借用表單的組裝;
  // 流程的匯出共用同一份可攜性目錄;其餘是受管定義安裝(`seed/`)沿用的建立、草稿、檢查與發布
  exports: [
    FormsService,
    FormVersionsService,
    FormPublishService,
    FormDefinitionChecker,
    SeedExportCatalogService,
  ],
})
export class FormDesignModule {}
