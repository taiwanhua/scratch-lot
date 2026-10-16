import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import { BaseRepository, type RepositoryModel } from "../base.repository";
import { ActionToken } from "../schemas/action-token.schema";
import { AuditLog } from "../schemas/audit-log.schema";
import { Customer } from "../schemas/customer.schema";
import { DataScopeRule } from "../schemas/data-scope-rule.schema";
import { DataScopeTarget } from "../schemas/data-scope-target.schema";
import { DemoItemOne } from "../schemas/demo-item-one.schema";
import { DemoItemTwo } from "../schemas/demo-item-two.schema";
import { FieldCategory } from "../schemas/field-category.schema";
import { Field } from "../schemas/field.schema";
import { FormSubmission } from "../schemas/form-submission.schema";
import { FormVersion } from "../schemas/form-version.schema";
import { Form } from "../schemas/form.schema";
import { Module as ModuleEntity } from "../schemas/module.schema";
import { NotificationSetting } from "../schemas/notification-setting.schema";
import { Notification } from "../schemas/notification.schema";
import { Org } from "../schemas/org.schema";
import { Permission } from "../schemas/permission.schema";
import { RefreshToken } from "../schemas/refresh-token.schema";
import { Role } from "../schemas/role.schema";
import { SeedDefinitionInstallation } from "../schemas/seed-definition-installation.schema";
import { UserPreference } from "../schemas/user-preference.schema";
import { User } from "../schemas/user.schema";
import { WorkflowInstance } from "../schemas/workflow-instance.schema";
import { WorkflowVersion } from "../schemas/workflow-version.schema";

/**
 * 底座的 BaseRepository 子類與文件型別(leaf 檔:不回指組裝入口 `database.module.ts`)。
 * 功能模組仍從 `database.module.ts` 的相容出口 import;新增底座 collection 時在此加一個子類,
 * 再登記到 `registrations.ts`。
 */

export type UserDocument = HydratedDocument<User>;
export type OrgDocument = HydratedDocument<Org>;
export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export type ActionTokenDocument = HydratedDocument<ActionToken>;
export type RoleDocument = HydratedDocument<Role>;
export type ModuleDocument = HydratedDocument<ModuleEntity>;
export type PermissionDocument = HydratedDocument<Permission>;
export type AuditLogDocument = HydratedDocument<AuditLog>;
export type CustomerDocument = HydratedDocument<Customer>;
export type DataScopeRuleDocument = HydratedDocument<DataScopeRule>;
export type DataScopeTargetDocument = HydratedDocument<DataScopeTarget>;
export type DemoItemOneDocument = HydratedDocument<DemoItemOne>;
export type DemoItemTwoDocument = HydratedDocument<DemoItemTwo>;
export type FieldDocument = HydratedDocument<Field>;
export type FieldCategoryDocument = HydratedDocument<FieldCategory>;
export type FormDocument = HydratedDocument<Form>;
export type FormVersionDocument = HydratedDocument<FormVersion>;
export type FormSubmissionDocument = HydratedDocument<FormSubmission>;
export type WorkflowVersionDocument = HydratedDocument<WorkflowVersion>;
export type SeedDefinitionInstallationDocument =
  HydratedDocument<SeedDefinitionInstallation>;
export type WorkflowInstanceDocument = HydratedDocument<WorkflowInstance>;
export type UserPreferenceDocument = HydratedDocument<UserPreference>;
export type NotificationDocument = HydratedDocument<Notification>;
export type NotificationSettingDocument = HydratedDocument<NotificationSetting>;

/** users(關聯歸屬資料:所屬組織走 org_user,資料層不自動過濾,ADR-0005)。 */
@Injectable()
export class UsersRepository extends BaseRepository<User, UserDocument> {
  constructor(
    @InjectModel(User.name) model: RepositoryModel<User, UserDocument>,
  ) {
    super(model);
  }
}

/** orgs(以自身 _id 判定可見,ADR-0005)。 */
@Injectable()
export class OrgsRepository extends BaseRepository<Org, OrgDocument> {
  constructor(@InjectModel(Org.name) model: RepositoryModel<Org, OrgDocument>) {
    super(model);
  }
}

/** refresh_tokens(屬帳號、非租戶資料,ADR-0003)。 */
@Injectable()
export class RefreshTokensRepository extends BaseRepository<
  RefreshToken,
  RefreshTokenDocument
> {
  constructor(
    @InjectModel(RefreshToken.name)
    model: RepositoryModel<RefreshToken, RefreshTokenDocument>,
  ) {
    super(model);
  }
}

/** action_tokens(啟用信 / 重設密碼的單次 token;屬帳號、非租戶資料,ADR-0009)。 */
@Injectable()
export class ActionTokensRepository extends BaseRepository<
  ActionToken,
  ActionTokenDocument
> {
  constructor(
    @InjectModel(ActionToken.name)
    model: RepositoryModel<ActionToken, ActionTokenDocument>,
  ) {
    super(model);
  }
}
/** roles(關聯歸屬資料:擁有組織走 org_role,資料層不自動過濾,ADR-0005)。 */
@Injectable()
export class RolesRepository extends BaseRepository<Role, RoleDocument> {
  constructor(
    @InjectModel(Role.name) model: RepositoryModel<Role, RoleDocument>,
  ) {
    super(model);
  }
}

/** modules(全域資料:模組樹種子,不受租戶過濾,ADR-0005)。 */
@Injectable()
export class ModulesRepository extends BaseRepository<
  ModuleEntity,
  ModuleDocument
> {
  constructor(
    @InjectModel(ModuleEntity.name)
    model: RepositoryModel<ModuleEntity, ModuleDocument>,
  ) {
    super(model);
  }
}

/** permissions(全域資料:權限種子,moduleId 指向擁有模組,ADR-0004)。 */
@Injectable()
export class PermissionsRepository extends BaseRepository<
  Permission,
  PermissionDocument
> {
  constructor(
    @InjectModel(Permission.name)
    model: RepositoryModel<Permission, PermissionDocument>,
  ) {
    super(model);
  }
}

/**
 * audit_logs(租戶資料:orgId = 動作發生的組織脈絡,ADR-0005)。
 * 只增不改(ADR-0004)由 schema 的中介層保證(audit-log.schema.ts):
 * 經此 repository 的 `updateById` / `updateMany` / `softDeleteById` 一律以 AuditLogImmutableError 拒絕。
 */
@Injectable()
export class AuditLogsRepository extends BaseRepository<
  AuditLog,
  AuditLogDocument
> {
  constructor(
    @InjectModel(AuditLog.name)
    model: RepositoryModel<AuditLog, AuditLogDocument>,
  ) {
    super(model);
  }
}

/**
 * 業務資料(租戶資料,`orgId` 指向所屬組織):目前只有「這個組織還有沒有資料掛著」的用途 —
 * 組織刪除前置的第四項(docs/modules/org-manager.md「刪除」)。各自的功能模組長出來時直接沿用。
 */
@Injectable()
export class CustomersRepository extends BaseRepository<
  Customer,
  CustomerDocument
> {
  constructor(
    @InjectModel(Customer.name)
    model: RepositoryModel<Customer, CustomerDocument>,
  ) {
    super(model);
  }
}

/** data_scope_rules(根組織專屬設定:每個資料目標一份規則,ADR-0008;不掛 tenantScope)。 */
@Injectable()
export class DataScopeRulesRepository extends BaseRepository<
  DataScopeRule,
  DataScopeRuleDocument
> {
  constructor(
    @InjectModel(DataScopeRule.name)
    model: RepositoryModel<DataScopeRule, DataScopeRuleDocument>,
  ) {
    super(model);
  }
}

/** data_scope_targets(全表種子資料:模組 seed 宣告的資料目標,ADR-0008)。 */
@Injectable()
export class DataScopeTargetsRepository extends BaseRepository<
  DataScopeTarget,
  DataScopeTargetDocument
> {
  constructor(
    @InjectModel(DataScopeTarget.name)
    model: RepositoryModel<DataScopeTarget, DataScopeTargetDocument>,
  ) {
    super(model);
  }
}

/** demo_items_one(第 5 段示範模組的業務資料)。 */
@Injectable()
export class DemoItemsOneRepository extends BaseRepository<
  DemoItemOne,
  DemoItemOneDocument
> {
  constructor(
    @InjectModel(DemoItemOne.name)
    model: RepositoryModel<DemoItemOne, DemoItemOneDocument>,
  ) {
    super(model);
  }
}

/** demo_items_two(第 5 段示範模組的業務資料)。 */
@Injectable()
export class DemoItemsTwoRepository extends BaseRepository<
  DemoItemTwo,
  DemoItemTwoDocument
> {
  constructor(
    @InjectModel(DemoItemTwo.name)
    model: RepositoryModel<DemoItemTwo, DemoItemTwoDocument>,
  ) {
    super(model);
  }
}

/** fields(欄位選項:`orgId` null = 全域種子、有值 = 租戶自訂,ADR-0005)。 */
@Injectable()
export class FieldsRepository extends BaseRepository<Field, FieldDocument> {
  constructor(
    @InjectModel(Field.name) model: RepositoryModel<Field, FieldDocument>,
  ) {
    super(model);
  }
}

/** field_categories(全域種子:租戶不可自訂,不掛 tenantScope,ADR-0005)。 */
@Injectable()
export class FieldCategoriesRepository extends BaseRepository<
  FieldCategory,
  FieldCategoryDocument
> {
  constructor(
    @InjectModel(FieldCategory.name)
    model: RepositoryModel<FieldCategory, FieldCategoryDocument>,
  ) {
    super(model);
  }
}

/** forms(表單;可見與否由 ownerOrgId + org_form 決定,不掛 tenantScope)。 */
@Injectable()
export class FormsRepository extends BaseRepository<Form, FormDocument> {
  constructor(
    @InjectModel(Form.name) model: RepositoryModel<Form, FormDocument>,
  ) {
    super(model);
  }
}

/** form_versions(表單版本;跟著表單走,不掛 tenantScope)。 */
@Injectable()
export class FormVersionsRepository extends BaseRepository<
  FormVersion,
  FormVersionDocument
> {
  constructor(
    @InjectModel(FormVersion.name)
    model: RepositoryModel<FormVersion, FormVersionDocument>,
  ) {
    super(model);
  }
}

/** form_submissions(模組資料表:可見範圍 + 資料範圍規則依 moduleKey 自動套用)。 */
@Injectable()
export class FormSubmissionsRepository extends BaseRepository<
  FormSubmission,
  FormSubmissionDocument
> {
  constructor(
    @InjectModel(FormSubmission.name)
    model: RepositoryModel<FormSubmission, FormSubmissionDocument>,
  ) {
    super(model);
  }
}

/** workflow_versions(流程版本;跟著流程走,不掛 tenantScope)。 */
@Injectable()
export class WorkflowVersionsRepository extends BaseRepository<
  WorkflowVersion,
  WorkflowVersionDocument
> {
  constructor(
    @InjectModel(WorkflowVersion.name)
    model: RepositoryModel<WorkflowVersion, WorkflowVersionDocument>,
  ) {
    super(model);
  }
}

/** seed_definition_installations(受管定義的安裝紀錄;全域設定資料,不掛 tenantScope)。 */
@Injectable()
export class SeedDefinitionInstallationsRepository extends BaseRepository<
  SeedDefinitionInstallation,
  SeedDefinitionInstallationDocument
> {
  constructor(
    @InjectModel(SeedDefinitionInstallation.name)
    model: RepositoryModel<
      SeedDefinitionInstallation,
      SeedDefinitionInstallationDocument
    >,
  ) {
    super(model);
  }
}

/**
 * workflow_instances(流程實例;模組資料表,`moduleKey` / `tenantId` 由 plugin 宣告與推導)。
 * 引擎的背景推進與審核者讀取不靠可見範圍(審核者不一定看得到申請人的組織):
 * 呼叫端以明確的租戶邊界條件查,讀取授權走 `canReadSubmissionRevision`。
 */
@Injectable()
export class WorkflowInstancesRepository extends BaseRepository<
  WorkflowInstance,
  WorkflowInstanceDocument
> {
  constructor(
    @InjectModel(WorkflowInstance.name)
    model: RepositoryModel<WorkflowInstance, WorkflowInstanceDocument>,
  ) {
    super(model);
  }
}

/** user_preferences(個人偏好;屬帳號、非租戶資料,同 refresh_tokens)。 */
@Injectable()
export class UserPreferencesRepository extends BaseRepository<
  UserPreference,
  UserPreferenceDocument
> {
  constructor(
    @InjectModel(UserPreference.name)
    model: RepositoryModel<UserPreference, UserPreferenceDocument>,
  ) {
    super(model);
  }
}

/** notifications(通知;屬收件人、依 recipientId 讀寫,同 user_preferences 不掛 tenantScope)。 */
@Injectable()
export class NotificationsRepository extends BaseRepository<
  Notification,
  NotificationDocument
> {
  constructor(
    @InjectModel(Notification.name)
    model: RepositoryModel<Notification, NotificationDocument>,
  ) {
    super(model);
  }
}

/** notification_settings(負責人提醒的收件人調整;以 tenantId 為邊界的租戶設定)。 */
@Injectable()
export class NotificationSettingsRepository extends BaseRepository<
  NotificationSetting,
  NotificationSettingDocument
> {
  constructor(
    @InjectModel(NotificationSetting.name)
    model: RepositoryModel<NotificationSetting, NotificationSettingDocument>,
  ) {
    super(model);
  }
}
