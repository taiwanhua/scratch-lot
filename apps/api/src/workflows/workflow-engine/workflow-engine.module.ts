import { Module } from "@nestjs/common";

import { AudienceCoreModule } from "../../audience/audience-core.module";
import { OperatorContextService } from "../../auth/operator-context.service";
import { DatabaseModule } from "../../database/database.module";
import { FormsCoreModule } from "../../forms/forms-core.module";
import { NotificationsCoreModule } from "../../notifications/notifications-core.module";
import { OrgsModule } from "../../orgs/orgs.module";
import { RealtimeModule } from "../../realtime/realtime.module";
import { ScheduledJobsModule } from "../../scheduled-jobs/scheduled-jobs.module";
import { WorkflowsCoreModule } from "../workflows-core.module";
import { AssigneeDelegationService } from "./assignee-delegation.service";
import { AssigneeInvalidationService } from "./assignee-invalidation.service";
import { AudienceSourceService } from "./audience-source.service";
import { BlockedInstancesService } from "./blocked-instances.service";
import { InstanceWithdrawService } from "./instance-withdraw.service";
import { FormLifecycleService } from "./lifecycle/form-lifecycle.service";
import { StepEntryService } from "./step-entry.service";
import { SubmissionReadAccess } from "./submission-read-access.service";
import { TaskActionsService } from "./task-actions.service";
import { WorkflowCcService } from "./workflow-cc.service";
import {
  WorkflowEngineHooks,
  WorkflowEngineService,
} from "./workflow-engine.service";
import { WorkflowNotifier } from "./workflow-notifier.service";
import { WorkflowOperationsResolver } from "./workflow-operations.resolver";
import { WorkflowOverdueService } from "./workflow-overdue.service";
import { WorkflowPresenter } from "./workflow-presenter.service";
import { WorkflowSubmitService } from "./workflow-submit.service";

/**
 * 審核流程引擎(`docs/modules/workflows.md`):推進(`advance` 的執行器)、送出的寫入順序、
 * 決定 / 改派 / 新增審核者 / 重試推進、撤回、審核者失效 hook、讀取授權 `canReadSubmissionRevision`、
 * 通知(經 `NotificationsCoreModule` 的 `notify()`;含 B16 逾時提醒的排程與 B17 知會)、阻擋清單、表單 / 流程的掛接點(`lifecycle/`)。表單執行端(送出、撤回、作廢、複製、讀取授權)與
 * 使用者管理(失效 hook)匯入它。
 *
 * `OperatorContextService` 以既有的 class 直接註冊(無狀態;同 `seed/definition-seed.module.ts`):掛接點的
 * 系統身分要用它算可見範圍,匯入 `AuthModule` 會連登入守門一起帶進來。
 */
@Module({
  imports: [
    DatabaseModule,
    AudienceCoreModule,
    FormsCoreModule,
    WorkflowsCoreModule,
    OrgsModule,
    NotificationsCoreModule,
    RealtimeModule,
    ScheduledJobsModule,
  ],
  providers: [
    OperatorContextService,
    FormLifecycleService,
    WorkflowEngineHooks,
    WorkflowEngineService,
    StepEntryService,
    AudienceSourceService,
    AssigneeDelegationService,
    WorkflowNotifier,
    WorkflowCcService,
    WorkflowOverdueService,
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
    AudienceSourceService,
    FormLifecycleService,
    WorkflowEngineService,
    WorkflowSubmitService,
    SubmissionReadAccess,
    TaskActionsService,
    InstanceWithdrawService,
    AssigneeInvalidationService,
    WorkflowPresenter,
    WorkflowCcService,
    WorkflowOverdueService,
  ],
})
export class WorkflowEngineModule {}
