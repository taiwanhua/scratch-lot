import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { SerialsModule } from "../../serials/serials.module";
import { StorageModule } from "../../storage/storage.module";
import { WorkflowEngineModule } from "../../workflows/workflow-engine/workflow-engine.module";
import { FormsCoreModule } from "../forms-core.module";
import { DisplayNamesService } from "./display-names.service";
import { FormFieldOptionsService } from "./form-field-options.service";
import { FormLookupService } from "./form-lookup.service";
import { FormSubmissionsResolver } from "./form-submissions.resolver";
import { FormSubmissionsService } from "./form-submissions.service";
import { FormUpgradeResolver } from "./form-upgrade.resolver";
import { FormUpgradeService } from "./form-upgrade.service";

/**
 * 表單執行(`docs/modules/forms.md`):新增選單、草稿 / 送出 / 修訂快照、欄位級投影、
 * 顯示名解析、lookup、類別選項、附件下載網址、舊版資料升級到新版、第一次送出時給單號(SerialsModule)。檔案儲存走 StorageModule(附件私有,ADR-0010)。
 */
@Module({
  // 綁流程的送出、撤回、讀取授權(`canReadSubmissionRevision`)走審核流程引擎
  imports: [
    DatabaseModule,
    StorageModule,
    SerialsModule,
    FormsCoreModule,
    WorkflowEngineModule,
  ],
  providers: [
    DisplayNamesService,
    FormFieldOptionsService,
    FormLookupService,
    FormSubmissionsService,
    FormSubmissionsResolver,
    FormUpgradeService,
    FormUpgradeResolver,
  ],
})
export class FormRuntimeModule {}
