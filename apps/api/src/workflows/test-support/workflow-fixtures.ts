import { expect } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import type { FieldDef } from "@repo/domain/form";
import type { StepDef, WorkflowEdge } from "@repo/domain/workflow";

import type { AuthTestApp } from "../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../auth/test-support/fixtures";
import type { OperatorContext } from "../../database/operator-context";
import { RelationService } from "../../database/relation.service";
import {
  ASSIGN,
  CREATE_FORM,
  PASSWORD,
  type SubmissionRow,
  createDraft,
  definitionOf,
  field,
  login,
  ok,
  publishDefinition,
  rootToken,
} from "../../forms/test-support/form-fixtures";
import { createRole } from "../../permission/test-support/fixtures";

/**
 * 審核流程 api 測試的共用夾具(TEST-07;同表單引擎的分檔方式):GraphQL 文件、一個租戶的組織 / 人 / 角色、
 * 病假表單、設計 → 發布 → 綁定的捷徑、送出與審核的捷徑。測試檔只寫行為。
 */

/** 一個情境要走十幾次到幾十次 GraphQL 往返,放寬單一測試逾時(理由同 `FORM_TEST_TIMEOUT_MS`)。 */
export const WORKFLOW_TEST_TIMEOUT_MS = 180_000;

export const WORKFLOW_MODULE = "demo.form";
export const FORM_KEY = "sick_leave";

const USER_MODULES = [
  WORKFLOW_MODULE,
  "apply-center",
  "apply-center.view-page",
];
const USER_PERMISSIONS = [`${WORKFLOW_MODULE}.*`, "apply-center.view"];
const ADMIN_MODULES = [
  "system",
  "system.workflows",
  "system.workflows.blocked-page",
  "system.forms",
  ...USER_MODULES,
];
const ADMIN_PERMISSIONS = [
  "system.workflows.*",
  "system.workflows.blocked-page.reassign",
  "system.forms.*",
  ...USER_PERMISSIONS,
];

/** 夾具寫關聯時的操作者。 */
const SYSTEM: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

// ---- GraphQL 文件 ----

const WORKFLOW_FIELDS = /* GraphQL */ `
  fragment WorkflowFields on WorkflowModel {
    id
    key
    name
    isShared
    currentVersion
    hasDraft
    forkedFrom {
      workflowKey
      version
    }
    assignments {
      tenantOrgId
    }
    boundForms {
      formKey
    }
    abilities {
      canEdit
      canPublish
      canAssign
      canFork
    }
  }
`;

const VERSION_FIELDS = /* GraphQL */ `
  fragment WorkflowVersionFields on WorkflowVersionModel {
    id
    workflowKey
    version
    status
    draftRevision
    baseVersion
    steps
    edges {
      from
      to
    }
    checkFormKey
    changelog
  }
`;

export const WORKFLOWS = /* GraphQL */ `
  ${WORKFLOW_FIELDS}
  query Workflows($input: WorkflowsInput!) {
    workflows(input: $input) {
      items {
        ...WorkflowFields
      }
      totalCount
    }
  }
`;

export const WORKFLOW = /* GraphQL */ `
  ${WORKFLOW_FIELDS}
  query Workflow($key: ID!) {
    workflow(key: $key) {
      workflow {
        ...WorkflowFields
      }
    }
  }
`;

export const CREATE_WORKFLOW = /* GraphQL */ `
  ${WORKFLOW_FIELDS}
  mutation CreateWorkflow($input: CreateWorkflowInput!) {
    createWorkflow(input: $input) {
      workflow {
        ...WorkflowFields
      }
    }
  }
`;

export const FORK_WORKFLOW = /* GraphQL */ `
  ${WORKFLOW_FIELDS}
  mutation ForkWorkflow($input: ForkWorkflowInput!) {
    forkWorkflow(input: $input) {
      workflow {
        ...WorkflowFields
      }
    }
  }
`;

export const ASSIGN_WORKFLOW = /* GraphQL */ `
  ${WORKFLOW_FIELDS}
  mutation AssignWorkflowToTenants($input: AssignWorkflowToTenantsInput!) {
    assignWorkflowToTenants(input: $input) {
      workflow {
        ...WorkflowFields
      }
    }
  }
`;

export const REVOKE_WORKFLOW = /* GraphQL */ `
  ${WORKFLOW_FIELDS}
  mutation RevokeWorkflowFromTenant($input: RevokeWorkflowFromTenantInput!) {
    revokeWorkflowFromTenant(input: $input) {
      workflow {
        ...WorkflowFields
      }
    }
  }
`;

export const WORKFLOW_VERSION = /* GraphQL */ `
  ${VERSION_FIELDS}
  query WorkflowVersion($workflowKey: ID!, $version: Int) {
    workflowVersion(workflowKey: $workflowKey, version: $version) {
      workflowVersion {
        ...WorkflowVersionFields
      }
      validation {
        errors {
          code
          stepKey
        }
        warnings {
          code
        }
      }
    }
  }
`;

export const CREATE_WORKFLOW_DRAFT = /* GraphQL */ `
  ${VERSION_FIELDS}
  mutation CreateWorkflowVersionDraft(
    $input: CreateWorkflowVersionDraftInput!
  ) {
    createWorkflowVersionDraft(input: $input) {
      workflowVersion {
        ...WorkflowVersionFields
      }
    }
  }
`;

export const SAVE_WORKFLOW_DRAFT = /* GraphQL */ `
  ${VERSION_FIELDS}
  mutation SaveWorkflowVersionDraft($input: SaveWorkflowVersionDraftInput!) {
    saveWorkflowVersionDraft(input: $input) {
      workflowVersion {
        ...WorkflowVersionFields
      }
      validation {
        errors {
          code
          stepKey
        }
      }
    }
  }
`;

export const DELETE_WORKFLOW_DRAFT = /* GraphQL */ `
  ${WORKFLOW_FIELDS}
  mutation DeleteWorkflowVersionDraft(
    $input: DeleteWorkflowVersionDraftInput!
  ) {
    deleteWorkflowVersionDraft(input: $input) {
      workflow {
        ...WorkflowFields
      }
    }
  }
`;

export const PUBLISH_WORKFLOW = /* GraphQL */ `
  ${VERSION_FIELDS}
  mutation PublishWorkflowVersion($input: PublishWorkflowVersionInput!) {
    publishWorkflowVersion(input: $input) {
      workflowVersion {
        ...WorkflowVersionFields
      }
    }
  }
`;

export const RETIRE_WORKFLOW = /* GraphQL */ `
  ${WORKFLOW_FIELDS}
  mutation RetireCurrentWorkflowVersion($input: WorkflowKeyInput!) {
    retireCurrentWorkflowVersion(input: $input) {
      workflow {
        ...WorkflowFields
      }
    }
  }
`;

export const VALIDATE_WORKFLOW = /* GraphQL */ `
  query ValidateWorkflowVersion($input: ValidateWorkflowVersionInput!) {
    validateWorkflowVersion(input: $input) {
      errors {
        code
        stepKey
      }
      warnings {
        code
      }
    }
  }
`;

export const BIND = /* GraphQL */ `
  mutation BindFormWorkflow($input: BindFormWorkflowInput!) {
    bindFormWorkflow(input: $input) {
      form {
        key
        workflowBinding {
          workflowKey
          workflowName
          isValid
        }
      }
    }
  }
`;

export const UNBIND = /* GraphQL */ `
  mutation UnbindFormWorkflow($input: UnbindFormWorkflowInput!) {
    unbindFormWorkflow(input: $input) {
      form {
        key
        workflowBinding {
          workflowKey
          isValid
        }
      }
    }
  }
`;

export const FORM_BINDING = /* GraphQL */ `
  query FormBinding($key: ID!) {
    form(key: $key) {
      form {
        key
        workflowBinding {
          workflowKey
          isValid
        }
      }
    }
  }
`;

export const FORM_WORKFLOW_OPTIONS = /* GraphQL */ `
  query FormWorkflowOptions($formKey: ID!) {
    formWorkflowOptions(formKey: $formKey) {
      items {
        workflowKey
        canBind
        issues {
          stepKey
          problem
        }
      }
      totalCount
    }
  }
`;

const TASK_FIELDS = /* GraphQL */ `
  fragment TaskFields on WorkflowTaskModel {
    id
    instanceId
    submissionId
    revision
    moduleKey
    formKey
    formName
    stepKey
    stepName
    taskKey
    status
    assignee {
      id
    }
    applicant {
      id
    }
    summary {
      title
    }
    instanceStatus
    decidedAt
    comment
    editVersion
  }
`;

const INSTANCE_FIELDS = /* GraphQL */ `
  ${TASK_FIELDS}
  fragment InstanceFields on WorkflowInstanceModel {
    id
    submissionId
    revision
    formKey
    workflowKey
    workflowVersion
    status
    summary {
      title
      date
    }
    activeStepKeys
    steps {
      stepKey
      kind
      status
      blocked
      allowReturn
      plan {
        taskKey
        assignee {
          id
        }
        previousAssignees {
          id
        }
        assigneeState
        taskId
      }
      decisions {
        taskKey
        decision
      }
    }
    history {
      kind
      stepKey
      taskKey
      result
    }
    outcome {
      kind
      stepKey
      taskKey
    }
    editVersion
    myTasks {
      ...TaskFields
    }
    abilities {
      canWithdraw
      canManage
    }
    finishedAt
  }
`;

export const MY_TASKS = /* GraphQL */ `
  ${TASK_FIELDS}
  query MyTasks($input: MyTasksInput!) {
    myTasks(input: $input) {
      items {
        ...TaskFields
      }
      totalCount
    }
  }
`;

export const MY_APPLICATIONS = /* GraphQL */ `
  query MyApplications($input: MyApplicationsInput!) {
    myApplications(input: $input) {
      items {
        id
        moduleKey
        formKey
        status
        blocked
        revision
        summary {
          title
        }
        currentInstanceId
        activeSteps {
          stepKey
        }
      }
      totalCount
    }
  }
`;

export const APPLICABLE_FORMS = /* GraphQL */ `
  query ApplicableForms {
    applicableForms {
      moduleKey
      forms {
        key
      }
    }
  }
`;

export const WORKFLOW_INSTANCE = /* GraphQL */ `
  ${INSTANCE_FIELDS}
  query WorkflowInstance($id: ID!) {
    workflowInstance(id: $id) {
      instance {
        ...InstanceFields
      }
    }
  }
`;

export const BLOCKED_INSTANCES = /* GraphQL */ `
  ${INSTANCE_FIELDS}
  query BlockedInstances($input: BlockedInstancesInput!) {
    blockedInstances(input: $input) {
      items {
        ...InstanceFields
      }
      totalCount
      truncated
    }
  }
`;

export const DECIDE = /* GraphQL */ `
  ${TASK_FIELDS}
  mutation DecideTask($input: DecideTaskInput!) {
    decideTask(input: $input) {
      task {
        ...TaskFields
      }
      result
    }
  }
`;

export const REASSIGN = /* GraphQL */ `
  ${TASK_FIELDS}
  mutation ReassignTask($input: ReassignTaskInput!) {
    reassignTask(input: $input) {
      task {
        ...TaskFields
      }
    }
  }
`;

export const ADD_ASSIGNEE = /* GraphQL */ `
  ${TASK_FIELDS}
  mutation AddStepAssignee($input: AddStepAssigneeInput!) {
    addStepAssignee(input: $input) {
      task {
        ...TaskFields
      }
    }
  }
`;

export const RETRY_ADVANCE = /* GraphQL */ `
  ${INSTANCE_FIELDS}
  mutation RetryAdvanceInstance($input: RetryAdvanceInstanceInput!) {
    retryAdvanceInstance(input: $input) {
      instance {
        ...InstanceFields
      }
    }
  }
`;

const SUBMISSION_FIELDS = /* GraphQL */ `
  fragment WorkflowSubmissionFields on FormSubmissionModel {
    id
    formKey
    status
    revision
    viewedRevision
    values
    summary {
      title
    }
    revisions {
      revision
    }
    editVersion
    currentInstanceId
    blocked
    voidReason
    voidReasonKey
    voidReasonLabel
    replacedById
    copiedFrom
    clearedFields
    abilities {
      canEdit
      canDelete
      canWithdraw
      canVoid
      canCopy
    }
  }
`;

export const SUBMISSION = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  query WorkflowSubmission($id: ID!, $revision: Int) {
    formSubmission(id: $id, revision: $revision) {
      submission {
        ...WorkflowSubmissionFields
      }
    }
  }
`;

export const SUBMIT_SUBMISSION = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation WorkflowSubmit($input: SubmitFormSubmissionInput!) {
    submitFormSubmission(input: $input) {
      submission {
        ...WorkflowSubmissionFields
      }
    }
  }
`;

export const SAVE_SUBMISSION = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation WorkflowSaveDraft($input: SaveFormDraftInput!) {
    saveFormDraft(input: $input) {
      submission {
        ...WorkflowSubmissionFields
      }
    }
  }
`;

export const WITHDRAW = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation WithdrawSubmission($input: WithdrawSubmissionInput!) {
    withdrawSubmission(input: $input) {
      submission {
        ...WorkflowSubmissionFields
      }
    }
  }
`;

export const VOID = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation VoidSubmission($input: VoidSubmissionInput!) {
    voidSubmission(input: $input) {
      submission {
        ...WorkflowSubmissionFields
      }
    }
  }
`;

export const COPY = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation CopySubmissionToDraft($input: CopySubmissionToDraftInput!) {
    copySubmissionToDraft(input: $input) {
      submission {
        ...WorkflowSubmissionFields
      }
    }
  }
`;

// ---- 形狀 ----

export interface WorkflowRow {
  id: string;
  key: string;
  name: string;
  isShared: boolean;
  currentVersion: number | null;
  hasDraft: boolean;
  forkedFrom: { workflowKey: string; version: number } | null;
  assignments: { tenantOrgId: string }[];
  boundForms: { formKey: string }[];
}

export interface WorkflowVersionRow {
  id: string;
  workflowKey: string;
  version: number | null;
  status: string;
  draftRevision: number;
  steps: Record<string, unknown>[];
  edges: WorkflowEdge[] | null;
  checkFormKey: string | null;
}

export interface TaskRow {
  id: string;
  instanceId: string;
  submissionId: string;
  revision: number;
  formKey: string;
  stepKey: string;
  stepName: string;
  taskKey: string;
  status: string;
  assignee: { id: string };
  applicant: { id: string } | null;
  summary: { title: string | null } | null;
  instanceStatus: string;
  comment: string | null;
  editVersion: number;
}

export interface InstanceRow {
  id: string;
  submissionId: string;
  revision: number;
  workflowKey: string;
  workflowVersion: number;
  status: string;
  summary: { title: string | null; date: string | null } | null;
  activeStepKeys: string[];
  steps: {
    stepKey: string;
    kind: string;
    status: string;
    blocked: boolean;
    allowReturn: boolean;
    plan: {
      taskKey: string;
      assignee: { id: string };
      previousAssignees: { id: string }[];
      assigneeState: string;
      /** 只有流程管理者拿得到(阻擋清單改派用);其他讀者 null */
      taskId: string | null;
    }[];
    decisions: { taskKey: string; decision: string }[];
  }[];
  history: {
    kind: string;
    stepKey: string | null;
    taskKey: string | null;
    result: string | null;
  }[];
  outcome: { kind: string; stepKey: string; taskKey: string } | null;
  editVersion: number;
  myTasks: TaskRow[];
  abilities: { canWithdraw: boolean; canManage: boolean };
  finishedAt: string | null;
}

export interface WfSubmissionRow {
  id: string;
  formKey: string;
  status: string;
  revision: number;
  viewedRevision: number;
  values: Record<string, unknown>;
  summary: { title: string | null } | null;
  revisions: { revision: number }[];
  editVersion: number;
  currentInstanceId: string | null;
  blocked: boolean;
  voidReason: string | null;
  voidReasonKey: string | null;
  voidReasonLabel: string | null;
  replacedById: string | null;
  copiedFrom: string | null;
  clearedFields: string[];
  abilities: {
    canEdit: boolean;
    canDelete: boolean;
    canWithdraw: boolean;
    canVoid: boolean;
    canCopy: boolean;
  };
}

// ---- 世界(一個租戶) ----

export interface Person {
  userId: Types.ObjectId;
  account: string;
  token: string;
}

let sequence = 0;

/** 建一個人(所屬組織第一個 = 當前組織)+ 他自己的一個角色,登入回 token。 */
export async function person(
  api: AuthTestApp,
  connection: Connection,
  orgId: Types.ObjectId,
  ownerOrgId: Types.ObjectId,
  options: { permissionKeys?: string[]; moduleKeys?: string[] } = {},
): Promise<Person> {
  sequence += 1;
  const account = `wf-user-${String(sequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds: [orgId],
  });
  await createRole(api.app, connection, {
    name: `流程測試角色 ${account}`,
    ownerOrgId,
    moduleKeys: options.moduleKeys ?? USER_MODULES,
    permissionKeys: options.permissionKeys ?? USER_PERMISSIONS,
    assignTo: [userId],
  });
  return { userId, account, token: await login(api, account) };
}

export interface World {
  api: AuthTestApp;
  connection: Connection;
  root: string;
  /** 租戶頂層 → 台北店 → 廚房部。 */
  tenant: Types.ObjectId;
  store: Types.ObjectId;
  kitchen: Types.ObjectId;
  /** 租戶管理員(站在租戶頂層;流程管理全部、阻擋清單、表單管理)。 */
  admin: Person;
  /** 申請人(廚房部)。 */
  applicant: Person;
  /** 台北店主管。 */
  manager: Person;
  /** 本租戶的「人資」角色(兩人)。 */
  hrRoleId: Types.ObjectId;
  hr: [Person, Person];
  /** 其他可當審核者的人(財務 / 法務 / 採購 / 原部門…),都在租戶頂層。 */
  staff: Person[];
}

/** 病假表單的欄位:標題、天數、指定審核者(使用者引用)、備註。 */
export const LEAVE_FIELDS: FieldDef[] = [
  field("title", "text"),
  field("days", "number"),
  field("approver", "reference", {
    source: { provider: "user", labelField: "name" },
  }),
  field("note", "text"),
  field("attachment", "upload"),
];

/** 上傳欄的存值(路徑要長得像本 API 簽出來的 `form/<uuid>.<副檔名>`)。 */
export function uploadValue(uuid: string): Record<string, unknown> {
  return {
    path: `form/${uuid}.pdf`,
    name: "證明.pdf",
    size: 1024,
    contentType: "application/pdf",
  };
}

/** 模組與權限(給需要別的組合的測試自己建人)。 */
export const PERSON_SCOPES = {
  userModules: [WORKFLOW_MODULE, "apply-center", "apply-center.view-page"],
  userPermissions: [`${WORKFLOW_MODULE}.*`, "apply-center.view"],
} as const;

export async function setupWorld(
  api: AuthTestApp,
  connection: Connection,
  staffCount = 8,
): Promise<World> {
  const root = await rootToken(api);
  const tenant = await createOrg(connection, { name: "流程租戶" });
  const store = await createOrg(connection, {
    name: "台北店",
    parentId: tenant,
  });
  const kitchen = await createOrg(connection, {
    name: "廚房部",
    parentId: store,
  });
  const admin = await person(api, connection, tenant, tenant, {
    moduleKeys: ADMIN_MODULES,
    permissionKeys: ADMIN_PERMISSIONS,
  });
  const applicant = await person(api, connection, kitchen, tenant);
  const manager = await person(api, connection, store, tenant);
  await setManagers(api, store, [manager.userId]);
  const hr1 = await person(api, connection, tenant, tenant);
  const hr2 = await person(api, connection, tenant, tenant);
  const hrRoleId = await createRole(api.app, connection, {
    name: "人資",
    ownerOrgId: tenant,
    assignTo: [hr1.userId, hr2.userId],
  });
  const staff: Person[] = [];
  for (let index = 0; index < staffCount; index += 1) {
    staff.push(await person(api, connection, tenant, tenant));
  }
  // 共用病假表單(root 建、發布、分派給租戶)
  await ok(api, root, CREATE_FORM, {
    input: { key: FORM_KEY, moduleKey: WORKFLOW_MODULE, name: "病假單" },
  });
  await publishDefinition(
    api,
    root,
    FORM_KEY,
    definitionOf(LEAVE_FIELDS),
    null,
  );
  await ok(api, root, ASSIGN, {
    input: { formKey: FORM_KEY, tenantOrgIds: [String(tenant)] },
  });
  return {
    api,
    connection,
    root,
    tenant,
    store,
    kitchen,
    admin,
    applicant,
    manager,
    hrRoleId,
    hr: [hr1, hr2],
    staff,
  };
}

/** 設組織主管(直接寫 `org_manager` 關聯;主管設定的 api 在票 A 測過)。 */
export async function setManagers(
  api: AuthTestApp,
  orgId: Types.ObjectId,
  userIds: Types.ObjectId[],
): Promise<void> {
  const relations = api.app.get(RelationService);
  await relations.linkMany(
    SYSTEM,
    userIds.map((userId) => ({
      type: "org_manager" as const,
      firstId: orgId,
      secondId: userId,
    })),
  );
}

// ---- 流程定義 ----

export function reviewStep(
  key: string,
  assignee: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): StepDef {
  return {
    key,
    name: key,
    assignee,
    mode: "any",
    ...overrides,
  } as unknown as StepDef;
}

/** 人員條件的一個條件列(AND 根群組裡的一列;`range` 只給所屬組織)。 */
export function audienceRow(
  field: "user" | "role" | "org" | "permission",
  value:
    readonly (string | Types.ObjectId)[] | { kind: "dynamic"; ref: string },
  range?: "self" | "descendants" | "ancestors",
): Record<string, unknown> {
  return {
    field,
    cond: "in",
    value: Array.isArray(value)
      ? { kind: "static", values: value.map(String) }
      : value,
    ...(field === "org" ? { range: range ?? "self" } : {}),
  };
}

/** 審核者來源「人員條件」:條件列全部 AND。 */
export function audienceSource(
  ...rows: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    kind: "audience",
    audience: { mode: "match", filter: { op: "AND", children: rows } },
  };
}

/** 指定這幾個人(人員條件的使用者條件列)。 */
export function usersSource(
  people: readonly (Person | Types.ObjectId)[],
): Record<string, unknown> {
  return audienceSource(
    audienceRow(
      "user",
      people.map((one) => ("userId" in one ? one.userId : one)),
    ),
  );
}

/** 持有這個角色的人(人員條件的角色條件列)。 */
export function roleSource(
  roleId: Types.ObjectId | string,
): Record<string, unknown> {
  return audienceSource(audienceRow("role", [roleId]));
}

export function usersStep(
  key: string,
  people: readonly Person[],
  overrides: Record<string, unknown> = {},
): StepDef {
  return reviewStep(key, usersSource(people), overrides);
}

export function joinStep(key: string): StepDef {
  return { key, name: key, kind: "join" };
}

export interface DefinitionShape {
  steps: StepDef[];
  edges?: WorkflowEdge[] | null;
  /** 缺席 = 存草稿時不送(不動已存的值) */
  checkFormKey?: string | null;
  /** 整個流程的知會對象;缺席 = 存草稿時不送(不動已存的值) */
  cc?: Record<string, unknown> | null;
}

/** 租戶管理員建客製流程 → 開草稿 → 存定義 → 發布;回發布後的版本。 */
export async function publishWorkflow(
  world: World,
  key: string,
  definition: DefinitionShape,
  token = world.admin.token,
): Promise<WorkflowVersionRow> {
  await ok(world.api, token, CREATE_WORKFLOW, {
    input: { key, name: `流程 ${key}` },
  });
  return publishWorkflowDraft(world, key, definition, null, token);
}

/** 對已存在的流程開草稿(以 `baseVersion` 為基底)→ 存定義 → 發布。 */
export async function publishWorkflowDraft(
  world: World,
  key: string,
  definition: DefinitionShape,
  baseVersion: number | null,
  token = world.admin.token,
): Promise<WorkflowVersionRow> {
  const draft = await ok<{
    createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
  }>(world.api, token, CREATE_WORKFLOW_DRAFT, {
    input: { workflowKey: key, baseVersion },
  });
  const saved = await saveWorkflowDraft(
    world,
    key,
    definition,
    draft.createWorkflowVersionDraft.workflowVersion.draftRevision,
    token,
  );
  const published = await ok<{
    publishWorkflowVersion: { workflowVersion: WorkflowVersionRow };
  }>(world.api, token, PUBLISH_WORKFLOW, {
    input: {
      workflowKey: key,
      expectedDraftRevision: saved.draftRevision,
      changelog: "測試發布",
    },
  });
  return published.publishWorkflowVersion.workflowVersion;
}

export async function saveWorkflowDraft(
  world: World,
  key: string,
  definition: DefinitionShape,
  expectedDraftRevision: number,
  token = world.admin.token,
): Promise<WorkflowVersionRow> {
  const saved = await ok<{
    saveWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
  }>(world.api, token, SAVE_WORKFLOW_DRAFT, {
    input: {
      workflowKey: key,
      expectedDraftRevision,
      definition: {
        steps: definition.steps,
        edges: definition.edges ?? null,
        ...(definition.checkFormKey !== undefined && {
          checkFormKey: definition.checkFormKey,
        }),
        ...(definition.cc !== undefined && { cc: definition.cc }),
      },
    },
  });
  return saved.saveWorkflowVersionDraft.workflowVersion;
}

export async function bindForm(
  world: World,
  workflowKey: string,
  formKey = FORM_KEY,
): Promise<void> {
  await ok(world.api, world.admin.token, BIND, {
    input: { formKey, workflowKey },
  });
}

/** 發布一個流程並綁到病假表單。 */
export async function useWorkflow(
  world: World,
  key: string,
  definition: DefinitionShape,
): Promise<void> {
  await publishWorkflow(world, key, definition);
  await bindForm(world, key);
}

// ---- 送出與審核 ----

/** 申請人建草稿並送出;回送出後的提交。 */
export const DEFAULT_LEAVE = { title: "病假三天", days: 3 };

export async function submitLeave(
  world: World,
  values: Record<string, unknown> | null = null,
  who: Person = world.applicant,
): Promise<WfSubmissionRow> {
  const draft = await createDraft(
    world.api,
    who.token,
    FORM_KEY,
    values ?? DEFAULT_LEAVE,
  );
  return submitExisting(world, draft, who);
}

export async function submitExisting(
  world: World,
  draft: Pick<SubmissionRow | WfSubmissionRow, "id" | "editVersion">,
  who: Person = world.applicant,
): Promise<WfSubmissionRow> {
  const data = await ok<{
    submitFormSubmission: { submission: WfSubmissionRow };
  }>(world.api, who.token, SUBMIT_SUBMISSION, {
    input: { id: draft.id, expectedEditVersion: draft.editVersion },
  });
  return data.submitFormSubmission.submission;
}

export async function submission(
  world: World,
  who: Person,
  id: string,
  revision?: number,
): Promise<WfSubmissionRow> {
  const data = await ok<{ formSubmission: { submission: WfSubmissionRow } }>(
    world.api,
    who.token,
    SUBMISSION,
    { id, ...(revision === undefined ? {} : { revision }) },
  );
  return data.formSubmission.submission;
}

export async function tasksOf(
  world: World,
  who: Person,
  done = false,
): Promise<TaskRow[]> {
  const data = await ok<{ myTasks: { items: TaskRow[] } }>(
    world.api,
    who.token,
    MY_TASKS,
    { input: { done, pageSize: 100 } },
  );
  return data.myTasks.items;
}

/** 某人在某筆提交上待處理的那個任務。 */
export async function pendingTaskOf(
  world: World,
  who: Person,
  submissionId: string,
): Promise<TaskRow> {
  const tasks = await tasksOf(world, who);
  const task = tasks.find((one) => one.submissionId === submissionId);
  if (!task) {
    throw new Error(`${who.account} 沒有提交 ${submissionId} 的待處理任務`);
  }
  return task;
}

export type DecisionName = "APPROVE" | "REJECT" | "RETURN";

export async function decide(
  world: World,
  who: Person,
  task: Pick<TaskRow, "id" | "editVersion">,
  decision: DecisionName,
  comment: string | null = decision === "APPROVE" ? null : "理由",
): Promise<{ task: TaskRow; result: string }> {
  const data = await ok<{ decideTask: { task: TaskRow; result: string } }>(
    world.api,
    who.token,
    DECIDE,
    {
      input: {
        taskId: task.id,
        expectedEditVersion: task.editVersion,
        decision,
        comment,
      },
    },
  );
  return data.decideTask;
}

/** 找到某人在某筆提交上的待處理任務並做決定。 */
export async function decideOn(
  world: World,
  who: Person,
  submissionId: string,
  decision: DecisionName,
): Promise<{ task: TaskRow; result: string }> {
  return decide(
    world,
    who,
    await pendingTaskOf(world, who, submissionId),
    decision,
  );
}

export async function instanceOf(
  world: World,
  who: Person,
  instanceId: string,
): Promise<InstanceRow> {
  const data = await ok<{ workflowInstance: { instance: InstanceRow } }>(
    world.api,
    who.token,
    WORKFLOW_INSTANCE,
    { id: instanceId },
  );
  return data.workflowInstance.instance;
}

/** 以申請人的身分讀這筆提交目前的實例。 */
export async function currentInstance(
  world: World,
  submissionId: string,
): Promise<InstanceRow> {
  const row = await submission(world, world.applicant, submissionId);
  if (row.currentInstanceId === null) {
    throw new Error(`提交 ${submissionId} 沒有實例`);
  }
  return instanceOf(world, world.applicant, row.currentInstanceId);
}

export function stepOfRow(
  instance: InstanceRow,
  stepKey: string,
): InstanceRow["steps"][number] {
  const step = instance.steps.find((one) => one.stepKey === stepKey);
  if (!step) {
    throw new Error(`實例沒有關卡 ${stepKey}`);
  }
  return step;
}

export async function retryAdvance(
  world: World,
  instanceId: string,
): Promise<InstanceRow> {
  const data = await ok<{ retryAdvanceInstance: { instance: InstanceRow } }>(
    world.api,
    world.admin.token,
    RETRY_ADVANCE,
    { input: { instanceId } },
  );
  return data.retryAdvanceInstance.instance;
}

// ---- 原始資料 ----

export function rawInstances(
  connection: Connection,
  submissionId: string,
): Promise<Record<string, unknown>[]> {
  return connection
    .collection("workflow_instances")
    .find({ submissionId: new Types.ObjectId(submissionId) })
    .sort({ revision: 1 })
    .toArray();
}

export function rawTasks(
  connection: Connection,
  instanceId: string,
): Promise<Record<string, unknown>[]> {
  return connection
    .collection("workflow_tasks")
    .find({ instanceId: new Types.ObjectId(instanceId) })
    .sort({ taskKey: 1 })
    .toArray();
}

/** 任務 key → 狀態(投影)。 */
export async function taskStatuses(
  connection: Connection,
  instanceId: string,
): Promise<Record<string, string>> {
  const tasks = await rawTasks(connection, instanceId);
  return Object.fromEntries(
    tasks.map((task) => [String(task.taskKey), String(task.status)]),
  );
}

export function rawSubmissionDoc(
  connection: Connection,
  id: string,
): Promise<Record<string, unknown> | null> {
  return connection
    .collection("form_submissions")
    .findOne({ _id: new Types.ObjectId(id) });
}

/** GraphQL 錯誤的 code(沒有錯誤回 undefined)。 */
export function errorCode(result: {
  errors?: { extensions?: Record<string, unknown> }[];
}): string | undefined {
  const code = result.errors?.[0]?.extensions?.code;
  return typeof code === "string" ? code : undefined;
}

export function errorReason(result: {
  errors?: { extensions?: Record<string, unknown> }[];
}): string | undefined {
  const reason = result.errors?.[0]?.extensions?.reason;
  return typeof reason === "string" ? reason : undefined;
}

export function expectNoErrors(result: { errors?: unknown[] }): void {
  expect(result.errors).toBeUndefined();
}

/** 申請人讀到的提交狀態(GraphQL enum 名)。 */
export async function submissionStatus(
  world: World,
  submissionId: string,
): Promise<string> {
  const row = await submission(world, world.applicant, submissionId);
  return row.status;
}

/** 目前實例的進行中關卡。 */
export async function activeStepsOf(
  world: World,
  submissionId: string,
): Promise<string[]> {
  const instance = await currentInstance(world, submissionId);
  return instance.activeStepKeys;
}

/** 某個任務的投影狀態。 */
export async function taskStatusOf(
  world: World,
  instanceId: string,
  taskKey: string,
): Promise<string | undefined> {
  const statuses = await taskStatuses(world.connection, instanceId);
  return statuses[taskKey];
}

/** 字串排序(`toSorted` 的比較函式)。 */
export function byText(left: string, right: string): number {
  return left.localeCompare(right);
}
