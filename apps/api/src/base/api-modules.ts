import { AudienceModule } from "../audience/audience.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DataScopeModule } from "../data-scope/data-scope.module";
import { DemoItemsOneModule } from "../demo-items-one/demo-items-one.module";
import { DemoItemsTwoModule } from "../demo-items-two/demo-items-two.module";
import { FieldsModule } from "../fields/fields.module";
import { FormDesignModule } from "../forms/form-design/form-design.module";
import { FormRuntimeModule } from "../forms/form-runtime/form-runtime.module";
import { ModuleManagerModule } from "../modules/module-manager.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OrgMembersModule } from "../orgs/org-members.module";
import { OrgsModule } from "../orgs/orgs.module";
import { PermissionModule } from "../permission/permission.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { RolesModule } from "../roles/roles.module";
import { ScheduledJobsModule } from "../scheduled-jobs/scheduled-jobs.module";
import { StorageModule } from "../storage/storage.module";
import { UserPreferencesModule } from "../user-preferences/user-preferences.module";
import { UsersModule } from "../users/users.module";
import { ApplyCenterModule } from "../workflows/apply-center/apply-center.module";
import { WorkflowDesignModule } from "../workflows/workflow-design/workflow-design.module";
import { WorkflowEngineModule } from "../workflows/workflow-engine/workflow-engine.module";
import type { ApiFeatureRegistration } from "./api-feature-registration";

/**
 * 底座的 API 功能清單(由 `app.module.ts` 組裝;順序即匯入順序)。
 * 新增底座功能在這裡加一筆;專案功能放 `project/api-modules.ts`,不寫在這裡。
 */
export const BASE_API_MODULES: readonly ApiFeatureRegistration[] = [
  { key: "auth", module: AuthModule },
  { key: "audit", module: AuditModule },
  { key: "scheduled-jobs", module: ScheduledJobsModule },
  { key: "permission", module: PermissionModule },
  { key: "storage", module: StorageModule },
  { key: "realtime", module: RealtimeModule },
  { key: "orgs", module: OrgsModule },
  { key: "users", module: UsersModule },
  { key: "org-members", module: OrgMembersModule },
  { key: "roles", module: RolesModule },
  { key: "module-manager", module: ModuleManagerModule },
  { key: "audience", module: AudienceModule },
  { key: "data-scope", module: DataScopeModule },
  { key: "fields", module: FieldsModule },
  { key: "demo-items-one", module: DemoItemsOneModule },
  { key: "demo-items-two", module: DemoItemsTwoModule },
  { key: "form-design", module: FormDesignModule },
  { key: "form-runtime", module: FormRuntimeModule },
  { key: "workflow-design", module: WorkflowDesignModule },
  { key: "workflow-engine", module: WorkflowEngineModule },
  { key: "apply-center", module: ApplyCenterModule },
  { key: "user-preferences", module: UserPreferencesModule },
  { key: "notifications", module: NotificationsModule },
];
