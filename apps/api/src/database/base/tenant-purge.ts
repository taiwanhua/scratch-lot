import {
  SEED_DEFINITION_INSTALLATIONS_COLLECTION,
  SEED_LOCK_COLLECTION,
} from "@repo/domain/seed";

import { BUSINESS_RELATIONSHIPS_COLLECTION } from "../schemas/business-relationship.schema";
import { CORE_RELATIONSHIPS_COLLECTION } from "../schemas/core-relationship.schema";
import { FORM_SUBMISSIONS_COLLECTION } from "../schemas/form-submission.schema";
import { FORMS_COLLECTION } from "../schemas/form.schema";
import { NOTIFICATION_SETTINGS_COLLECTION } from "../schemas/notification-setting.schema";
import { NOTIFICATIONS_COLLECTION } from "../schemas/notification.schema";
import { ORGS_COLLECTION } from "../schemas/org.schema";
import { PRINT_AGENTS_COLLECTION } from "../schemas/print-agent.schema";
import { PRINT_JOBS_COLLECTION } from "../schemas/print-job.schema";
import { PRINTERS_COLLECTION } from "../schemas/printer.schema";
import { SCHEDULED_JOB_RUNS_COLLECTION } from "../schemas/scheduled-job-run.schema";
import { SERIAL_COUNTERS_COLLECTION } from "../schemas/serial-counter.schema";
import { SIDEBAR_BADGE_SETTINGS_COLLECTION } from "../schemas/sidebar-badge-setting.schema";
import { USER_DELEGATIONS_COLLECTION } from "../schemas/user-delegation.schema";
import { USER_PREFERENCES_COLLECTION } from "../schemas/user-preference.schema";
import { WORKFLOW_INSTANCES_COLLECTION } from "../schemas/workflow-instance.schema";
import { WORKFLOW_TASKS_COLLECTION } from "../schemas/workflow-task.schema";
import { WORKFLOWS_COLLECTION } from "../schemas/workflow.schema";
import type { TenantPurgeRegistration } from "../tenant-purge";

const BY_TENANT_ID = { by: "tenantId" } as const;

/**
 * 底座 collection 的「清空租戶時怎麼刪」(`database/tenant-purge.ts`)。
 * 新增底座 collection 時在這裡加一筆;帶 `tenantId` 欄的一律 `BY_TENANT_ID`。
 */
export const BASE_TENANT_PURGE_REGISTRATIONS: readonly TenantPurgeRegistration[] =
  [
    // 組織、使用者、角色、核心關聯:要先算出租戶的組織樹、只屬於它的人、它擁有的角色
    {
      collection: ORGS_COLLECTION,
      rule: { by: "dedicated", reason: "租戶頂層與它所有下層組織" },
    },
    {
      collection: "users",
      rule: {
        by: "dedicated",
        reason: "只屬於這個租戶的人硬刪;也屬於其他組織的只移除所屬",
      },
    },
    {
      collection: "roles",
      rule: { by: "dedicated", reason: "擁有組織(org_role)在租戶內的角色" },
    },
    {
      collection: CORE_RELATIONSHIPS_COLLECTION,
      rule: {
        by: "dedicated",
        reason: "端點是租戶組織、被刪的使用者或被刪的角色的關聯",
      },
    },
    // 帶 tenantId 的表
    { collection: BUSINESS_RELATIONSHIPS_COLLECTION, rule: BY_TENANT_ID },
    { collection: "demo_items_one", rule: BY_TENANT_ID },
    { collection: "demo_items_two", rule: BY_TENANT_ID },
    { collection: FORM_SUBMISSIONS_COLLECTION, rule: BY_TENANT_ID },
    { collection: WORKFLOWS_COLLECTION, rule: BY_TENANT_ID },
    { collection: WORKFLOW_INSTANCES_COLLECTION, rule: BY_TENANT_ID },
    { collection: WORKFLOW_TASKS_COLLECTION, rule: BY_TENANT_ID },
    { collection: SERIAL_COUNTERS_COLLECTION, rule: BY_TENANT_ID },
    { collection: NOTIFICATIONS_COLLECTION, rule: BY_TENANT_ID },
    { collection: NOTIFICATION_SETTINGS_COLLECTION, rule: BY_TENANT_ID },
    { collection: SIDEBAR_BADGE_SETTINGS_COLLECTION, rule: BY_TENANT_ID },
    { collection: PRINT_AGENTS_COLLECTION, rule: BY_TENANT_ID },
    { collection: PRINTERS_COLLECTION, rule: BY_TENANT_ID },
    { collection: PRINT_JOBS_COLLECTION, rule: BY_TENANT_ID },
    // 以組織 / 使用者歸屬的表
    {
      collection: "audit_logs",
      // 只增不改的稽核也刪(清空 = 當作沒發生過);根組織做的開通 / 清空紀錄不在租戶組織內,留著
      rule: { by: "match", anyOf: [{ field: "orgId", in: "tenantOrgs" }] },
    },
    {
      collection: "customers",
      rule: { by: "match", anyOf: [{ field: "orgId", in: "tenantOrgs" }] },
    },
    {
      collection: "fields",
      rule: { by: "match", anyOf: [{ field: "orgId", in: "tenantOrgs" }] },
    },
    {
      collection: FORMS_COLLECTION,
      // 客製表單(ownerOrgId = 租戶頂層);共用表單的分派在 business_relationships(org_form)
      rule: {
        by: "match",
        anyOf: [{ field: "ownerOrgId", in: "tenantOrgs" }],
      },
    },
    {
      collection: "form_versions",
      rule: {
        by: "match",
        anyOf: [
          { field: "formKey", in: "deleted", of: FORMS_COLLECTION, key: "key" },
        ],
      },
    },
    {
      collection: "workflow_versions",
      rule: {
        by: "match",
        anyOf: [
          {
            field: "workflowKey",
            in: "deleted",
            of: WORKFLOWS_COLLECTION,
            key: "key",
          },
        ],
      },
    },
    {
      collection: "refresh_tokens",
      // 被刪的人、被刪的會員的 token;還留著的人若正站在租戶的組織,也一併登出
      rule: {
        by: "match",
        anyOf: [
          { field: "accountId", in: "purgedUsers" },
          { field: "accountId", in: "deleted", of: "customers" },
          { field: "currentOrgId", in: "tenantOrgs" },
        ],
      },
    },
    {
      collection: "action_tokens",
      rule: { by: "match", anyOf: [{ field: "userId", in: "purgedUsers" }] },
    },
    {
      collection: USER_PREFERENCES_COLLECTION,
      rule: { by: "match", anyOf: [{ field: "userId", in: "purgedUsers" }] },
    },
    {
      collection: USER_DELEGATIONS_COLLECTION,
      rule: {
        by: "match",
        anyOf: [
          { field: "userId", in: "purgedUsers" },
          { field: "delegateUserId", in: "purgedUsers" },
        ],
      },
    },
    // 全平台共用的定義與紀錄
    {
      collection: "modules",
      rule: { by: "keep", reason: "模組樹是全平台共用的 seed 定義" },
    },
    {
      collection: "permissions",
      rule: { by: "keep", reason: "權限是全平台共用的 seed 定義" },
    },
    {
      collection: "field_categories",
      rule: { by: "keep", reason: "欄位類別是全域資料,租戶不可自訂" },
    },
    {
      collection: "data_scope_rules",
      rule: { by: "keep", reason: "資料範圍規則是根組織專屬設定" },
    },
    {
      collection: "data_scope_targets",
      rule: { by: "keep", reason: "資料目標是根組織專屬設定" },
    },
    {
      collection: SEED_DEFINITION_INSTALLATIONS_COLLECTION,
      rule: { by: "keep", reason: "受管定義的安裝紀錄是全平台的" },
    },
    {
      collection: SEED_LOCK_COLLECTION,
      rule: { by: "keep", reason: "seed / migration 的鎖" },
    },
    {
      collection: SCHEDULED_JOB_RUNS_COLLECTION,
      rule: { by: "keep", reason: "排程任務的執行紀錄是全平台的" },
    },
  ];
