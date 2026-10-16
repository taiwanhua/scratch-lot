import type { FormDefinition } from "@repo/domain/form";
import type { ReviewStepDef, WorkflowDefinition } from "@repo/domain/workflow";
import {
  FormSubmissionStatus,
  ModuleEngine,
  ModuleSidebarType,
  type MyApplicationsQuery,
  type WorkflowFieldsFragment,
  type WorkflowInstanceFieldsFragment,
  WorkflowInstanceStatus,
  WorkflowStepStatus,
  type WorkflowTaskFieldsFragment,
  WorkflowTaskStatus,
  type WorkflowVersionFieldsFragment,
  WorkflowVersionStatus,
} from "@repo/graphql";

import type { TestModule } from "./auth-handlers";
import { field } from "./form-fixtures";
import { HR_ROLE_ID, roleInSubmissionOrg } from "./workflow-audience-fixtures";

/**
 * 審核流程的測試夾具(形狀以 api 的回傳為準:`apps/api/src/workflows/**\/*.test.ts` 的斷言、
 * `packages/graphql/src/documents/workflows.graphql` / `apply-center.graphql` 的 fragment;TEST-08 / TEST-12)。
 *
 * 兩個範例流程:
 * - 「病假審核」(直線):直屬主管(主管第 1 層)→ 人資(角色,`any`,天數 ≤ 1 跳過)
 * - 「採購審核」(平行):原部門初審 → 財務 / 法務 / 採購三條分支 → 匯合 → 原部門確認
 */
export const STAMP = "2026-09-20T02:00:00.000Z";

export const WORKFLOWS_ROUTE = "/system/workflows";
export const BLOCKED_ROUTE = "/system/workflows/blocked-page";
export const APPLY_CENTER_ROUTE = "/apply-center";
export const APPLY_VIEW_ROUTE = "/apply-center/view-page";
export const DEMO_GROUP_FORM_KEY = "demo.form";
export const LEAVE_FORM_KEY = "sick_leave";
export const DEMO_GROUP_FORM_ROUTES = {
  list: "/demo/form",
  viewPage: "/demo/form/view-page",
  createPage: "/demo/form/create-page",
  editPage: "/demo/form/edit-page",
} as const;

/** seed 的圖示 key(`@repo/ui` 圖示登錄表裡都有);隱藏頁沒有圖示。 */
const ICON_BY_KEY: Partial<Record<string, string>> = {
  system: "settings",
  "system.workflows": "account-tree",
  "apply-center": "mail",
  [DEMO_GROUP_FORM_KEY]: "description",
};

const moduleOf = (
  id: string,
  key: string,
  name: string,
  parentId: string | null,
  sidebarType: ModuleSidebarType,
  route: string,
  permissions: readonly string[],
): TestModule => ({
  id,
  key,
  name,
  parentId,
  sidebarType,
  engine: key === DEMO_GROUP_FORM_KEY ? ModuleEngine.Form : ModuleEngine.Fixed,
  order: 4,
  route,
  icon: ICON_BY_KEY[key] ?? null,
  permissions: [...permissions],
});

/** 流程管理 + 阻擋清單(seed `system.ts` 的形狀;隱藏頁自有 `reassign`,不靠父模組 wildcard)。 */
export const workflowsModules = (
  permissions: readonly string[],
  blockedPermissions: readonly string[] = [],
): TestModule[] => [
  moduleOf(
    "m-system",
    "system",
    "系統管理",
    null,
    ModuleSidebarType.Group,
    "/system",
    [],
  ),
  moduleOf(
    "m-workflows",
    "system.workflows",
    "流程管理",
    "m-system",
    ModuleSidebarType.Link,
    WORKFLOWS_ROUTE,
    permissions,
  ),
  moduleOf(
    "m-workflows-blocked",
    "system.workflows.blocked-page",
    "阻擋清單",
    "m-workflows",
    ModuleSidebarType.Hidden,
    BLOCKED_ROUTE,
    blockedPermissions,
  ),
];

/** 申請中心 + 詳情隱藏頁(seed `apply-center.ts`)。 */
export const applyCenterModules = (
  permissions: readonly string[] = ["apply-center.view"],
): TestModule[] => [
  moduleOf(
    "m-apply",
    "apply-center",
    "申請中心",
    null,
    ModuleSidebarType.Link,
    APPLY_CENTER_ROUTE,
    permissions,
  ),
  moduleOf(
    "m-apply-view",
    "apply-center.view-page",
    "申請詳情",
    "m-apply",
    ModuleSidebarType.Hidden,
    APPLY_VIEW_ROUTE,
    [],
  ),
];

/** 示範表單(群組內)(表單模組,四頁,掛在 `demo` 群組底下;seed `demo.form.ts`)。 */
export const demoGroupFormModules = (
  permissions: readonly string[],
): TestModule[] => [
  moduleOf(
    "m-demo-group-form",
    DEMO_GROUP_FORM_KEY,
    "示範表單(群組內)",
    "m-demo",
    ModuleSidebarType.Link,
    DEMO_GROUP_FORM_ROUTES.list,
    permissions,
  ),
  ...(["view-page", "create-page", "edit-page"] as const).map((page) =>
    moduleOf(
      `m-demo-group-form-${page}`,
      `${DEMO_GROUP_FORM_KEY}.${page}`,
      page,
      "m-demo-group-form",
      ModuleSidebarType.Hidden,
      `${DEMO_GROUP_FORM_ROUTES.list}/${page}`,
      [],
    ),
  ),
];

/** 病假單:假別、天數、事由、代理主管(使用者引用,給「表單欄位」來源用)。 */
export const leaveDefinition = (): FormDefinition => ({
  fields: [
    field("kind", "假別", "text"),
    field("days", "天數", "number"),
    field("reason", "事由", "text"),
    field("approver", "代理主管", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "user", labelField: "name" },
    }),
  ],
  layout: {
    sections: [
      {
        key: "main",
        title: "病假內容",
        rows: [
          {
            cols: [
              { fieldKey: "kind", span: 6 },
              { fieldKey: "days", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "reason", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "reason", date: null, amount: null },
  prefills: [],
});

export const reviewStep = (
  key: string,
  name: string,
  overrides: Partial<ReviewStepDef> = {},
): ReviewStepDef => ({
  key,
  name,
  kind: "review",
  assignee: { kind: "manager", level: 1 },
  mode: "any",
  skipWhen: null,
  allowReturn: true,
  ...overrides,
});

/** 病假審核(直線):主管 → 人資(人員條件:角色 + 單據所屬組織)。 */
export const leaveWorkflowDefinition = (
  hrRoleId = HR_ROLE_ID,
): WorkflowDefinition => ({
  steps: [
    reviewStep("manager", "直屬主管"),
    reviewStep("hr", "人資", { assignee: roleInSubmissionOrg(hrRoleId) }),
  ],
  edges: null,
});

/** 採購審核(平行):初審 → 財務 / 法務 / 採購 → 匯合 → 確認。 */
export const purchaseWorkflowDefinition = (): WorkflowDefinition => ({
  steps: [
    reviewStep("review", "原部門初審"),
    reviewStep("finance", "財務部審核"),
    reviewStep("legal", "法務部審核", { mode: "all" }),
    reviewStep("purchase", "採購部審核"),
    { key: "merge", name: "三部門匯合", kind: "join" },
    reviewStep("confirm", "原部門確認"),
  ],
  edges: [
    { from: "review", to: "finance" },
    { from: "finance", to: "merge" },
    { from: "review", to: "legal" },
    { from: "legal", to: "merge" },
    { from: "review", to: "purchase" },
    { from: "purchase", to: "merge" },
    { from: "merge", to: "confirm" },
  ],
});

export const workflowFragment = (
  overrides: Partial<WorkflowFieldsFragment> = {},
): WorkflowFieldsFragment => ({
  id: `wf-${overrides.key ?? "leave_review"}`,
  key: "leave_review",
  name: "病假審核",
  isShared: false,
  ownerOrgId: "org-1",
  ownerOrgName: "平台根組織",
  forkedFrom: null,
  currentVersion: 1,
  hasDraft: true,
  assignments: [],
  boundForms: [],
  abilities: {
    canEdit: true,
    canPublish: true,
    canAssign: false,
    canFork: true,
  },
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

export const workflowVersionFragment = (
  definition: WorkflowDefinition,
  overrides: Partial<WorkflowVersionFieldsFragment> = {},
): WorkflowVersionFieldsFragment => ({
  id: "wv-draft",
  workflowKey: "leave_review",
  version: null,
  status: WorkflowVersionStatus.Draft,
  draftRevision: 1,
  baseVersion: null,
  steps: definition.steps.map((step): Record<string, unknown> => ({ ...step })),
  edges: definition.edges ?? null,
  checkFormKey: null,
  changelog: null,
  publishedAt: null,
  publishedBy: null,
  ...overrides,
});

const user = (id: string, name: string) => ({ id, name });

export const APPLICANT = user("user-2", "小明");
export const MANAGER = user("user-1", "小華");
export const HR = user("user-3", "人資阿美");

type InstanceStep = WorkflowInstanceFieldsFragment["steps"][number];

export const instanceStep = (
  stepKey: string,
  name: string,
  overrides: Partial<InstanceStep> = {},
): InstanceStep => ({
  stepKey,
  name,
  kind: "review",
  mode: "any",
  allowReturn: true,
  status: WorkflowStepStatus.Pending,
  blocked: false,
  plan: [],
  decisions: [],
  ...overrides,
});

export const planItem = (
  taskKey: string,
  assignee: { id: string; name: string },
  overrides: Partial<InstanceStep["plan"][number]> = {},
): InstanceStep["plan"][number] => ({
  taskKey,
  assignee,
  previousAssignees: [],
  assigneeState: "active",
  taskId: null,
  ...overrides,
});

export const taskFragment = (
  overrides: Partial<WorkflowTaskFieldsFragment> = {},
): WorkflowTaskFieldsFragment => ({
  id: "task-1",
  instanceId: "inst-1",
  submissionId: "sub-leave-1",
  revision: 1,
  moduleKey: DEMO_GROUP_FORM_KEY,
  moduleName: "示範表單(群組內)",
  formKey: LEAVE_FORM_KEY,
  formName: "病假單",
  stepKey: "manager",
  stepName: "直屬主管",
  taskKey: "manager-1",
  status: WorkflowTaskStatus.Pending,
  assignee: MANAGER,
  applicant: APPLICANT,
  summary: { title: "病假三天", date: null, amount: null },
  instanceStatus: WorkflowInstanceStatus.Running,
  decidedAt: null,
  comment: null,
  editVersion: 1,
  createdAt: STAMP,
  ...overrides,
});

/** 病假審核的實例:主管關卡進行中、派給小華(`myTasks` 由 world 依登入者算)。 */
export const instanceFragment = (
  overrides: Partial<WorkflowInstanceFieldsFragment> = {},
): WorkflowInstanceFieldsFragment => ({
  id: "inst-1",
  submissionId: "sub-leave-1",
  revision: 1,
  moduleKey: DEMO_GROUP_FORM_KEY,
  moduleName: "示範表單(群組內)",
  formKey: LEAVE_FORM_KEY,
  formName: "病假單",
  formVersion: 1,
  workflowKey: "leave_review",
  workflowName: "病假審核",
  workflowVersion: 1,
  status: WorkflowInstanceStatus.Running,
  summary: { title: "病假三天", date: null, amount: null },
  applicant: APPLICANT,
  activeStepKeys: ["manager"],
  steps: [
    instanceStep("manager", "直屬主管", {
      status: WorkflowStepStatus.Active,
      plan: [planItem("manager-1", MANAGER)],
    }),
    instanceStep("hr", "人資"),
  ],
  history: [
    {
      at: STAMP,
      kind: "started",
      stepKey: null,
      taskKey: null,
      user: APPLICANT,
      toUser: null,
      comment: null,
      result: null,
    },
    {
      at: STAMP,
      kind: "step_entered",
      stepKey: "manager",
      taskKey: null,
      user: null,
      toUser: null,
      comment: null,
      result: null,
    },
    {
      at: STAMP,
      kind: "task_created",
      stepKey: "manager",
      taskKey: "manager-1",
      user: MANAGER,
      toUser: null,
      comment: null,
      result: null,
    },
  ],
  outcome: null,
  editVersion: 3,
  myTasks: [],
  abilities: { canWithdraw: false, canManage: false },
  createdAt: STAMP,
  updatedAt: STAMP,
  finishedAt: null,
  ...overrides,
});

export type ApplicationRow =
  MyApplicationsQuery["myApplications"]["items"][number];

export const applicationRow = (
  overrides: Partial<ApplicationRow> = {},
): ApplicationRow => ({
  id: "sub-leave-1",
  moduleKey: DEMO_GROUP_FORM_KEY,
  moduleName: "示範表單(群組內)",
  formKey: LEAVE_FORM_KEY,
  formName: "病假單",
  status: FormSubmissionStatus.Reviewing,
  blocked: false,
  revision: 1,
  summary: { title: "病假三天", date: null, amount: null },
  currentInstanceId: "inst-1",
  activeSteps: [{ stepKey: "manager", name: "直屬主管" }],
  submittedAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});
