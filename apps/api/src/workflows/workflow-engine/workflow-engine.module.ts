import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { FormsCoreModule } from "../../forms/forms-core.module";
import { MailModule } from "../../mail/mail.module";
import { OrgsModule } from "../../orgs/orgs.module";
import { RealtimeModule } from "../../realtime/realtime.module";
import { WorkflowsCoreModule } from "../workflows-core.module";
import { AssigneeInvalidationService } from "./assignee-invalidation.service";
import { BlockedInstancesService } from "./blocked-instances.service";
import { InstanceWithdrawService } from "./instance-withdraw.service";
import { StepEntryService } from "./step-entry.service";
import { SubmissionReadAccess } from "./submission-read-access.service";
import { TaskActionsService } from "./task-actions.service";
import {
  WorkflowEngineHooks,
  WorkflowEngineService,
} from "./workflow-engine.service";
import { WorkflowNotifier } from "./workflow-notifier.service";
import { WorkflowOperationsResolver } from "./workflow-operations.resolver";
import { WorkflowPresenter } from "./workflow-presenter.service";
import { WorkflowSubmitService } from "./workflow-submit.service";

/**
 * 審核流程引擎(`docs/modules/workflows.md`):推進(`advance` 的執行器)、送出的寫入順序、
 * 決定 / 改派 / 新增審核者 / 重試推進、撤回、審核者失效 hook、讀取授權 `canReadSubmissionRevision`、
 * 通知信、阻擋清單。表單執行端(送出、撤回、作廢、複製、讀取授權)與使用者管理(失效 hook)匯入它。
 */
@Module({
  imports: [
    DatabaseModule,
    FormsCoreModule,
    WorkflowsCoreModule,
    OrgsModule,
    MailModule,
    RealtimeModule,
  ],
  providers: [
    WorkflowEngineHooks,
    WorkflowEngineService,
    StepEntryService,
    WorkflowNotifier,
    WorkflowSubmitService,
    SubmissionReadAccess,
    TaskActionsService,
    InstanceWithdrawService,
    AssigneeInvalidationService,
    BlockedInstancesService,
    WorkflowPresenter,
    WorkflowOperationsResolver,
  ],
  exports: [
    WorkflowEngineService,
    WorkflowSubmitService,
    SubmissionReadAccess,
    TaskActionsService,
    InstanceWithdrawService,
    AssigneeInvalidationService,
    WorkflowPresenter,
  ],
})
export class WorkflowEngineModule {}
