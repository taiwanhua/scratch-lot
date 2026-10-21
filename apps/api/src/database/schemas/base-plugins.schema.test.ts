import { describe, expect, it } from "@jest/globals";
import type { Schema } from "mongoose";

import { BASE_FIELD_PATHS } from "../plugins/base-fields.plugin";
import {
  type TenantScope,
  getTenantScope,
} from "../plugins/tenant-scope.plugin";
import { ActionTokenSchema } from "./action-token.schema";
import { AuditLogSchema } from "./audit-log.schema";
import { BusinessRelationshipSchema } from "./business-relationship.schema";
import { CoreRelationshipSchema } from "./core-relationship.schema";
import { CustomerSchema } from "./customer.schema";
import { DataScopeRuleSchema } from "./data-scope-rule.schema";
import { DataScopeTargetSchema } from "./data-scope-target.schema";
import { DemoItemOneSchema } from "./demo-item-one.schema";
import { DemoItemTwoSchema } from "./demo-item-two.schema";
import { FieldCategorySchema } from "./field-category.schema";
import { FieldSchema } from "./field.schema";
import { FormSubmissionSchema } from "./form-submission.schema";
import { FormVersionSchema } from "./form-version.schema";
import { FormSchema } from "./form.schema";
import { ModuleSchema } from "./module.schema";
import { NotificationSettingSchema } from "./notification-setting.schema";
import { NotificationSchema } from "./notification.schema";
import { OrgSchema } from "./org.schema";
import { PermissionSchema } from "./permission.schema";
import { RefreshTokenSchema } from "./refresh-token.schema";
import { RoleSchema } from "./role.schema";
import { SidebarBadgeSettingSchema } from "./sidebar-badge-setting.schema";
import { UserDelegationSchema } from "./user-delegation.schema";
import { UserPreferenceSchema } from "./user-preference.schema";
import { UserSchema } from "./user.schema";
import { WorkflowInstanceSchema } from "./workflow-instance.schema";
import { WorkflowTaskSchema } from "./workflow-task.schema";
import { WorkflowVersionSchema } from "./workflow-version.schema";
import { WorkflowSchema } from "./workflow.schema";

/** 全部底座 collection(docs/data-model.md「Collection 一覽」,29 張)。 */
const ALL_SCHEMAS: Record<string, Schema> = {
  orgs: OrgSchema,
  users: UserSchema,
  customers: CustomerSchema,
  roles: RoleSchema,
  modules: ModuleSchema,
  permissions: PermissionSchema,
  core_relationships: CoreRelationshipSchema,
  business_relationships: BusinessRelationshipSchema,
  data_scope_rules: DataScopeRuleSchema,
  data_scope_targets: DataScopeTargetSchema,
  field_categories: FieldCategorySchema,
  fields: FieldSchema,
  demo_items_one: DemoItemOneSchema,
  demo_items_two: DemoItemTwoSchema,
  forms: FormSchema,
  form_versions: FormVersionSchema,
  form_submissions: FormSubmissionSchema,
  workflows: WorkflowSchema,
  workflow_versions: WorkflowVersionSchema,
  workflow_instances: WorkflowInstanceSchema,
  workflow_tasks: WorkflowTaskSchema,
  refresh_tokens: RefreshTokenSchema,
  action_tokens: ActionTokenSchema,
  audit_logs: AuditLogSchema,
  user_preferences: UserPreferenceSchema,
  user_delegations: UserDelegationSchema,
  notifications: NotificationSchema,
  notification_settings: NotificationSettingSchema,
  sidebar_badge_settings: SidebarBadgeSettingSchema,
};

/**
 * 租戶資料 = 掛 tenantScope plugin 的 collection(ADR-0005「掛 orgId 的業務 collection」+ orgs 自身)。
 * 其餘(種子表、平台級帳號表、以關聯決定歸屬的 users/roles、token、核心關聯)不受租戶過濾。
 *
 * `kind` 決定過濾吃哪個範圍(ADR-0005「管理範圍與可見範圍的分工」):
 * **只有 `orgs` 是治理類**(吃 `managedOrgIds`),其餘都是業務類(吃 `visibleOrgIds`)—
 * 這張表就是那條分界線的正本,新 collection 加進來時要在這裡決定自己屬哪一類。
 */
/** 預設的共用宣告(不可共用)。 */
const PRIVATE = { mode: "private" } as const;

const TENANT_SCOPED: Record<string, TenantScope> = {
  orgs: {
    path: "_id",
    allowGlobal: false,
    kind: "governance",
    moduleData: false,
    sharing: PRIVATE,
    refFields: [],
  },
  customers: {
    path: "orgId",
    allowGlobal: false,
    kind: "business",
    moduleData: false,
    sharing: PRIVATE,
    refFields: [],
  },
  fields: {
    path: "orgId",
    allowGlobal: true,
    kind: "business",
    moduleData: false,
    sharing: PRIVATE,
    refFields: [],
  },
  demo_items_one: {
    path: "orgId",
    allowGlobal: false,
    kind: "business",
    moduleData: true,
    sharing: PRIVATE,
    refFields: [],
  },
  demo_items_two: {
    path: "orgId",
    allowGlobal: false,
    kind: "business",
    moduleData: true,
    sharing: {
      mode: "shareable",
      defaultShareOrgs: "none",
      editable: true,
      sharedByFields: [],
    },
    refFields: [],
  },
  // 依欄位共用(表單設定 sharedByFieldKeys → sharedOrgIds;共用清單固定空)
  form_submissions: {
    path: "orgId",
    allowGlobal: false,
    kind: "business",
    moduleData: true,
    sharing: {
      mode: "shareable",
      defaultShareOrgs: "none",
      editable: false,
      sharedByFields: [{ path: "sharedOrgIds", includeDescendants: false }],
    },
    refFields: [],
  },
  workflow_instances: {
    path: "orgId",
    allowGlobal: false,
    kind: "business",
    moduleData: true,
    sharing: PRIVATE,
    refFields: [],
  },
  audit_logs: {
    path: "orgId",
    allowGlobal: false,
    kind: "business",
    moduleData: false,
    sharing: PRIVATE,
    refFields: [],
  },
};

/** 模組資料表(`moduleData: true`):兩張示範表 + 表單提交 + 流程實例;business 類的其他表不是模組資料。 */
const MODULE_DATA_COLLECTIONS = new Set([
  "demo_items_one",
  "demo_items_two",
  "form_submissions",
  "workflow_instances",
]);

describe("底座 schema 的 plugin 掛載(ADR-0005 / ADR-0007)", () => {
  it("全部 29 張 collection 都掛 baseFields:timestamps + createdBy / updatedBy / deletedAt", () => {
    expect(Object.keys(ALL_SCHEMAS)).toHaveLength(29);
    for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
      expect({ name, timestamps: schema.get("timestamps") }).toEqual({
        name,
        timestamps: true,
      });
      for (const path of BASE_FIELD_PATHS) {
        expect({ name, path, pathType: schema.pathType(path) }).toEqual({
          name,
          path,
          pathType: "real",
        });
      }
    }
  });

  it("租戶資料的判定 = 是否掛 tenantScope;清單與設定明確列出,其餘一律不受租戶過濾", () => {
    for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
      expect({ name, scope: getTenantScope(schema) }).toEqual({
        name,
        scope: TENANT_SCOPED[name],
      });
    }
  });

  it("moduleData 的 moduleKey / tenantId 只宣告在模組資料表;fields / audit_logs / customers 沒有", () => {
    // 只看掛 tenantScope 的表:data_scope_* 有自己的 moduleKey 欄位(目標識別鍵),不是模組資料
    for (const name of Object.keys(TENANT_SCOPED)) {
      const schema = ALL_SCHEMAS[name];
      const expected = MODULE_DATA_COLLECTIONS.has(name)
        ? "real"
        : "adhocOrUndefined";
      expect({
        name,
        moduleKey: schema?.pathType("moduleKey"),
        tenantId: schema?.pathType("tenantId"),
      }).toEqual({ name, moduleKey: expected, tenantId: expected });
    }
  });
});
