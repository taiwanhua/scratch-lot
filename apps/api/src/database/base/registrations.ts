import { getModelToken } from "@nestjs/mongoose";
import type { Model } from "mongoose";

import {
  SEED_DEFINITION_INSTALLATIONS_COLLECTION,
  SEED_LOCK_COLLECTION,
} from "@repo/domain/seed";

import { BusinessRelationshipsRepository } from "../business-relationships.repository";
import { FormSubmissionUsageCounter } from "../form-submission-usage";
import type { DatabaseRegistration } from "../registration";
import { RelationService } from "../relation.service";
import { ScheduledJobRunsStore } from "../scheduled-job-runs.store";
import { ActionToken, ActionTokenSchema } from "../schemas/action-token.schema";
import { AuditLog, AuditLogSchema } from "../schemas/audit-log.schema";
import {
  BUSINESS_RELATIONSHIPS_COLLECTION,
  BusinessRelationship,
  BusinessRelationshipSchema,
} from "../schemas/business-relationship.schema";
import {
  CORE_RELATIONSHIPS_COLLECTION,
  CoreRelationship,
  CoreRelationshipSchema,
} from "../schemas/core-relationship.schema";
import { Customer, CustomerSchema } from "../schemas/customer.schema";
import {
  DataScopeRule,
  DataScopeRuleSchema,
} from "../schemas/data-scope-rule.schema";
import {
  DataScopeTarget,
  DataScopeTargetSchema,
} from "../schemas/data-scope-target.schema";
import {
  DemoItemOne,
  DemoItemOneSchema,
} from "../schemas/demo-item-one.schema";
import {
  DemoItemTwo,
  DemoItemTwoSchema,
} from "../schemas/demo-item-two.schema";
import {
  FieldCategory,
  FieldCategorySchema,
} from "../schemas/field-category.schema";
import { Field, FieldSchema } from "../schemas/field.schema";
import {
  FORM_SUBMISSIONS_COLLECTION,
  FormSubmission,
  FormSubmissionSchema,
} from "../schemas/form-submission.schema";
import { FormVersion, FormVersionSchema } from "../schemas/form-version.schema";
import { FORMS_COLLECTION, Form, FormSchema } from "../schemas/form.schema";
import { Module as ModuleEntity, ModuleSchema } from "../schemas/module.schema";
import {
  NOTIFICATION_SETTINGS_COLLECTION,
  NotificationSetting,
  NotificationSettingSchema,
} from "../schemas/notification-setting.schema";
import {
  NOTIFICATIONS_COLLECTION,
  Notification,
  NotificationSchema,
} from "../schemas/notification.schema";
import { ORGS_COLLECTION, Org, OrgSchema } from "../schemas/org.schema";
import { Permission, PermissionSchema } from "../schemas/permission.schema";
import {
  PRINT_AGENTS_COLLECTION,
  PrintAgent,
  PrintAgentSchema,
} from "../schemas/print-agent.schema";
import {
  PRINT_JOBS_COLLECTION,
  PrintJob,
  PrintJobSchema,
} from "../schemas/print-job.schema";
import {
  PRINTERS_COLLECTION,
  Printer,
  PrinterSchema,
} from "../schemas/printer.schema";
import {
  RefreshToken,
  RefreshTokenSchema,
} from "../schemas/refresh-token.schema";
import { Role, RoleSchema } from "../schemas/role.schema";
import {
  SCHEDULED_JOB_RUNS_COLLECTION,
  ScheduledJobRun,
  ScheduledJobRunSchema,
} from "../schemas/scheduled-job-run.schema";
import {
  SeedDefinitionInstallation,
  SeedDefinitionInstallationSchema,
} from "../schemas/seed-definition-installation.schema";
import { SeedLock, SeedLockSchema } from "../schemas/seed-lock.schema";
import {
  SIDEBAR_BADGE_SETTINGS_COLLECTION,
  SidebarBadgeSetting,
  SidebarBadgeSettingSchema,
} from "../schemas/sidebar-badge-setting.schema";
import {
  USER_DELEGATIONS_COLLECTION,
  UserDelegation,
  UserDelegationSchema,
} from "../schemas/user-delegation.schema";
import {
  USER_PREFERENCES_COLLECTION,
  UserPreference,
  UserPreferenceSchema,
} from "../schemas/user-preference.schema";
import { User, UserSchema } from "../schemas/user.schema";
import {
  WORKFLOW_INSTANCES_COLLECTION,
  WorkflowInstance,
  WorkflowInstanceSchema,
} from "../schemas/workflow-instance.schema";
import {
  WORKFLOW_TASKS_COLLECTION,
  WorkflowTask,
  WorkflowTaskSchema,
} from "../schemas/workflow-task.schema";
import {
  WorkflowVersion,
  WorkflowVersionSchema,
} from "../schemas/workflow-version.schema";
import {
  WORKFLOWS_COLLECTION,
  Workflow,
  WorkflowSchema,
} from "../schemas/workflow.schema";
import { SeedLockReader } from "../seed-lock.reader";
import { WorkflowSubmissionStore } from "../workflow-submission-store";
import { WorkflowTasksRepository } from "../workflow-tasks.repository";
import { WorkflowsRepository } from "../workflows.repository";
import {
  ActionTokensRepository,
  AuditLogsRepository,
  CustomersRepository,
  DataScopeRulesRepository,
  DataScopeTargetsRepository,
  DemoItemsOneRepository,
  DemoItemsTwoRepository,
  FieldCategoriesRepository,
  FieldsRepository,
  FormSubmissionsRepository,
  FormVersionsRepository,
  FormsRepository,
  ModulesRepository,
  NotificationSettingsRepository,
  NotificationsRepository,
  OrgsRepository,
  PermissionsRepository,
  PrintAgentsRepository,
  PrintJobsRepository,
  PrintersRepository,
  RefreshTokensRepository,
  RolesRepository,
  SeedDefinitionInstallationsRepository,
  SidebarBadgeSettingsRepository,
  UserDelegationsRepository,
  UserPreferencesRepository,
  UsersRepository,
  WorkflowInstancesRepository,
  WorkflowVersionsRepository,
} from "./repositories";

/**
 * 底座的資料登記(docs/concepts/data-layer-and-isolation.md「底座與專案資料的組裝」):
 * 每張底座 collection、它的資料層出口,以及「刪組織 / 撤銷開通前要問有沒有資料」的組織歸屬檢查。
 * 新增底座 collection 時在對應的一組加 model 與 repository;帶組織歸屬的業務表同時加一項檢查。
 *
 * 以 `tenantId` 為邊界的 workflows / workflow_tasks 不經 BaseRepository,它們的存在性檢查
 * 由 `OrgBusinessDataReader` 以專用 adapter 處理,不列在 `orgDataChecks`。
 * `audit_logs` 刻意沒有檢查:只增不改的歷史紀錄不阻擋刪除(ADR-0004)。
 */
export const BASE_DATABASE_REGISTRATIONS: readonly DatabaseRegistration[] = [
  {
    key: "accounts",
    models: [
      { name: User.name, collection: "users", schema: UserSchema },
      {
        name: RefreshToken.name,
        collection: "refresh_tokens",
        schema: RefreshTokenSchema,
      },
      {
        name: ActionToken.name,
        collection: "action_tokens",
        schema: ActionTokenSchema,
      },
      { name: Customer.name, collection: "customers", schema: CustomerSchema },
    ],
    repositories: [
      { modelName: User.name, provider: UsersRepository },
      { modelName: RefreshToken.name, provider: RefreshTokensRepository },
      { modelName: ActionToken.name, provider: ActionTokensRepository },
      { modelName: Customer.name, provider: CustomersRepository },
    ],
    orgDataChecks: [
      {
        key: "base.customers",
        modelName: Customer.name,
        repository: CustomersRepository,
        ownerField: "orgId",
      },
    ],
  },
  {
    key: "orgs",
    models: [
      { name: Org.name, collection: ORGS_COLLECTION, schema: OrgSchema },
    ],
    repositories: [{ modelName: Org.name, provider: OrgsRepository }],
    orgDataChecks: [],
  },
  {
    key: "authorization",
    models: [
      { name: Role.name, collection: "roles", schema: RoleSchema },
      { name: ModuleEntity.name, collection: "modules", schema: ModuleSchema },
      {
        name: Permission.name,
        collection: "permissions",
        schema: PermissionSchema,
      },
    ],
    repositories: [
      { modelName: Role.name, provider: RolesRepository },
      { modelName: ModuleEntity.name, provider: ModulesRepository },
      { modelName: Permission.name, provider: PermissionsRepository },
    ],
    orgDataChecks: [],
  },
  {
    key: "relationships",
    models: [
      {
        name: CoreRelationship.name,
        collection: CORE_RELATIONSHIPS_COLLECTION,
        schema: CoreRelationshipSchema,
      },
      {
        name: BusinessRelationship.name,
        collection: BUSINESS_RELATIONSHIPS_COLLECTION,
        schema: BusinessRelationshipSchema,
      },
    ],
    repositories: [
      {
        modelName: CoreRelationship.name,
        provider: {
          provide: RelationService,
          inject: [getModelToken(CoreRelationship.name)],
          useFactory: (model: Model<CoreRelationship>) =>
            new RelationService(model),
        },
      },
      {
        modelName: BusinessRelationship.name,
        provider: {
          provide: BusinessRelationshipsRepository,
          inject: [getModelToken(BusinessRelationship.name)],
          useFactory: (model: Model<BusinessRelationship>) =>
            new BusinessRelationshipsRepository(model),
        },
      },
    ],
    orgDataChecks: [],
  },
  {
    key: "audit",
    models: [
      { name: AuditLog.name, collection: "audit_logs", schema: AuditLogSchema },
    ],
    repositories: [{ modelName: AuditLog.name, provider: AuditLogsRepository }],
    orgDataChecks: [],
  },
  {
    key: "data-scope",
    models: [
      {
        name: DataScopeRule.name,
        collection: "data_scope_rules",
        schema: DataScopeRuleSchema,
      },
      {
        name: DataScopeTarget.name,
        collection: "data_scope_targets",
        schema: DataScopeTargetSchema,
      },
    ],
    repositories: [
      { modelName: DataScopeRule.name, provider: DataScopeRulesRepository },
      { modelName: DataScopeTarget.name, provider: DataScopeTargetsRepository },
    ],
    orgDataChecks: [],
  },
  {
    key: "fields",
    models: [
      { name: Field.name, collection: "fields", schema: FieldSchema },
      {
        name: FieldCategory.name,
        collection: "field_categories",
        schema: FieldCategorySchema,
      },
    ],
    repositories: [
      { modelName: Field.name, provider: FieldsRepository },
      { modelName: FieldCategory.name, provider: FieldCategoriesRepository },
    ],
    orgDataChecks: [
      {
        key: "base.fields",
        modelName: Field.name,
        repository: FieldsRepository,
        ownerField: "orgId",
      },
    ],
  },
  {
    key: "demo",
    models: [
      {
        name: DemoItemOne.name,
        collection: "demo_items_one",
        schema: DemoItemOneSchema,
      },
      {
        name: DemoItemTwo.name,
        collection: "demo_items_two",
        schema: DemoItemTwoSchema,
      },
    ],
    repositories: [
      { modelName: DemoItemOne.name, provider: DemoItemsOneRepository },
      { modelName: DemoItemTwo.name, provider: DemoItemsTwoRepository },
    ],
    orgDataChecks: [
      {
        key: "base.demo-items-one",
        modelName: DemoItemOne.name,
        repository: DemoItemsOneRepository,
        ownerField: "orgId",
      },
      {
        key: "base.demo-items-two",
        modelName: DemoItemTwo.name,
        repository: DemoItemsTwoRepository,
        ownerField: "orgId",
      },
    ],
  },
  {
    key: "forms",
    models: [
      { name: Form.name, collection: FORMS_COLLECTION, schema: FormSchema },
      {
        name: FormVersion.name,
        collection: "form_versions",
        schema: FormVersionSchema,
      },
      {
        name: FormSubmission.name,
        collection: FORM_SUBMISSIONS_COLLECTION,
        schema: FormSubmissionSchema,
      },
    ],
    repositories: [
      { modelName: Form.name, provider: FormsRepository },
      { modelName: FormVersion.name, provider: FormVersionsRepository },
      { modelName: FormSubmission.name, provider: FormSubmissionsRepository },
      {
        modelName: FormSubmission.name,
        provider: {
          provide: FormSubmissionUsageCounter,
          inject: [getModelToken(FormSubmission.name)],
          useFactory: (model: Model<FormSubmission>) =>
            new FormSubmissionUsageCounter(model),
        },
      },
      {
        modelName: FormSubmission.name,
        provider: {
          provide: WorkflowSubmissionStore,
          inject: [getModelToken(FormSubmission.name)],
          useFactory: (model: Model<FormSubmission>) =>
            new WorkflowSubmissionStore(model),
        },
      },
    ],
    orgDataChecks: [
      // forms 的歸屬是租戶頂層(沒有 orgId):只有租戶頂層會命中,正是撤銷開通會問到的那一層
      {
        key: "base.forms",
        modelName: Form.name,
        repository: FormsRepository,
        ownerField: "ownerOrgId",
      },
      {
        key: "base.form-submissions",
        modelName: FormSubmission.name,
        repository: FormSubmissionsRepository,
        ownerField: "orgId",
      },
    ],
  },
  {
    key: "workflows",
    models: [
      {
        name: Workflow.name,
        collection: WORKFLOWS_COLLECTION,
        schema: WorkflowSchema,
      },
      {
        name: WorkflowVersion.name,
        collection: "workflow_versions",
        schema: WorkflowVersionSchema,
      },
      {
        name: WorkflowInstance.name,
        collection: WORKFLOW_INSTANCES_COLLECTION,
        schema: WorkflowInstanceSchema,
      },
      {
        name: WorkflowTask.name,
        collection: WORKFLOW_TASKS_COLLECTION,
        schema: WorkflowTaskSchema,
      },
    ],
    repositories: [
      {
        modelName: Workflow.name,
        provider: {
          provide: WorkflowsRepository,
          inject: [getModelToken(Workflow.name)],
          useFactory: (model: Model<Workflow>) =>
            new WorkflowsRepository(model),
        },
      },
      { modelName: WorkflowVersion.name, provider: WorkflowVersionsRepository },
      {
        modelName: WorkflowInstance.name,
        provider: WorkflowInstancesRepository,
      },
      {
        modelName: WorkflowTask.name,
        provider: {
          provide: WorkflowTasksRepository,
          inject: [getModelToken(WorkflowTask.name)],
          useFactory: (model: Model<WorkflowTask>) =>
            new WorkflowTasksRepository(model),
        },
      },
    ],
    orgDataChecks: [
      {
        key: "base.workflow-instances",
        modelName: WorkflowInstance.name,
        repository: WorkflowInstancesRepository,
        ownerField: "orgId",
      },
    ],
  },
  {
    // 受管定義的安裝紀錄(全域設定資料,只有共用定義會被安裝)與共用互斥鎖的唯讀出口;都沒有組織歸屬
    key: "seed",
    models: [
      {
        name: SeedDefinitionInstallation.name,
        collection: SEED_DEFINITION_INSTALLATIONS_COLLECTION,
        schema: SeedDefinitionInstallationSchema,
      },
      {
        name: SeedLock.name,
        collection: SEED_LOCK_COLLECTION,
        schema: SeedLockSchema,
      },
    ],
    repositories: [
      {
        modelName: SeedDefinitionInstallation.name,
        provider: SeedDefinitionInstallationsRepository,
      },
      {
        modelName: SeedLock.name,
        provider: {
          provide: SeedLockReader,
          inject: [getModelToken(SeedLock.name)],
          useFactory: (model: Model<SeedLock>) => new SeedLockReader(model),
        },
      },
    ],
    orgDataChecks: [],
  },
  {
    // 排程任務的執行紀錄(系統紀錄,沒有組織歸屬):只經專用的 store 讀寫
    key: "scheduled-jobs",
    models: [
      {
        name: ScheduledJobRun.name,
        collection: SCHEDULED_JOB_RUNS_COLLECTION,
        schema: ScheduledJobRunSchema,
      },
    ],
    repositories: [
      {
        modelName: ScheduledJobRun.name,
        provider: {
          provide: ScheduledJobRunsStore,
          inject: [getModelToken(ScheduledJobRun.name)],
          useFactory: (model: Model<ScheduledJobRun>) =>
            new ScheduledJobRunsStore(model),
        },
      },
    ],
    orgDataChecks: [],
  },
  {
    // 個人偏好(每個使用者一筆;屬帳號、沒有組織歸屬,同 refresh_tokens)
    key: "user-preferences",
    models: [
      {
        name: UserPreference.name,
        collection: USER_PREFERENCES_COLLECTION,
        schema: UserPreferenceSchema,
      },
    ],
    repositories: [
      { modelName: UserPreference.name, provider: UserPreferencesRepository },
    ],
    orgDataChecks: [],
  },
  {
    // 代理人(屬帳號、沒有組織歸屬,同 user_preferences)
    key: "user-delegations",
    models: [
      {
        name: UserDelegation.name,
        collection: USER_DELEGATIONS_COLLECTION,
        schema: UserDelegationSchema,
      },
    ],
    repositories: [
      { modelName: UserDelegation.name, provider: UserDelegationsRepository },
    ],
    orgDataChecks: [],
  },
  {
    // 通知:收件人的通知屬帳號、不擋刪組織;通知設定是以 tenantId 為邊界的租戶設定
    key: "notifications",
    models: [
      {
        name: Notification.name,
        collection: NOTIFICATIONS_COLLECTION,
        schema: NotificationSchema,
      },
      {
        name: NotificationSetting.name,
        collection: NOTIFICATION_SETTINGS_COLLECTION,
        schema: NotificationSettingSchema,
      },
    ],
    repositories: [
      { modelName: Notification.name, provider: NotificationsRepository },
      {
        modelName: NotificationSetting.name,
        provider: NotificationSettingsRepository,
      },
    ],
    orgDataChecks: [],
  },
  {
    // 側欄數字設定:誰看得到某模組的側欄數字(以 tenantId 為邊界的租戶設定,同通知設定)
    key: "sidebar-badges",
    models: [
      {
        name: SidebarBadgeSetting.name,
        collection: SIDEBAR_BADGE_SETTINGS_COLLECTION,
        schema: SidebarBadgeSettingSchema,
      },
    ],
    repositories: [
      {
        modelName: SidebarBadgeSetting.name,
        provider: SidebarBadgeSettingsRepository,
      },
    ],
    orgDataChecks: [],
  },
  {
    // 列印(docs/modules/printers.md):代理程式、印表機、列印工作;都掛在分店上
    key: "printing",
    models: [
      {
        name: PrintAgent.name,
        collection: PRINT_AGENTS_COLLECTION,
        schema: PrintAgentSchema,
      },
      {
        name: Printer.name,
        collection: PRINTERS_COLLECTION,
        schema: PrinterSchema,
      },
      {
        name: PrintJob.name,
        collection: PRINT_JOBS_COLLECTION,
        schema: PrintJobSchema,
      },
    ],
    repositories: [
      { modelName: PrintAgent.name, provider: PrintAgentsRepository },
      { modelName: Printer.name, provider: PrintersRepository },
      { modelName: PrintJob.name, provider: PrintJobsRepository },
    ],
    orgDataChecks: [
      {
        key: "base.print-agents",
        modelName: PrintAgent.name,
        repository: PrintAgentsRepository,
        ownerField: "orgId",
      },
      {
        key: "base.printers",
        modelName: Printer.name,
        repository: PrintersRepository,
        ownerField: "orgId",
      },
      {
        key: "base.print-jobs",
        modelName: PrintJob.name,
        repository: PrintJobsRepository,
        ownerField: "orgId",
      },
    ],
  },
];
