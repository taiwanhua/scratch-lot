import { randomUUID } from "node:crypto";

import { type GraphqlResponse, graphql, graphqlOk } from "./graphql";

/**
 * 劇本 20–29(審核流程、代理、知會、批次核准、通知)的前置操作。正本是 `packages/graphql/src/documents/workflows.graphql`、
 * `apply-center.graphql`、`forms.graphql`、`form-submissions.graphql`、`orgs.graphql`,
 * 這裡只抄 e2e 用到的欄位;前置一律走 api(TEST-11)。
 */

const SET_ORG_MANAGERS = `
mutation SetOrgManagers($input: SetOrgManagersInput!) {
  setOrgManagers(input: $input) { org { id } }
}`;

const CREATE_FORM = `
mutation CreateForm($input: CreateFormInput!) {
  createForm(input: $input) { form { key } }
}`;

const CREATE_FORM_VERSION_DRAFT = `
mutation CreateFormVersionDraft($input: CreateFormVersionDraftInput!) {
  createFormVersionDraft(input: $input) { formVersion { draftRevision } }
}`;

const SAVE_FORM_VERSION_DRAFT = `
mutation SaveFormVersionDraft($input: SaveFormVersionDraftInput!) {
  saveFormVersionDraft(input: $input) { formVersion { draftRevision } }
}`;

const PUBLISH_FORM_VERSION = `
mutation PublishFormVersion($input: PublishFormVersionInput!) {
  publishFormVersion(input: $input) { formVersion { version } }
}`;

const ASSIGN_FORM_TO_TENANTS = `
mutation AssignFormToTenants($input: AssignFormToTenantsInput!) {
  assignFormToTenants(input: $input) { form { key } }
}`;

const CREATE_WORKFLOW = `
mutation CreateWorkflow($input: CreateWorkflowInput!) {
  createWorkflow(input: $input) { workflow { key } }
}`;

const CREATE_WORKFLOW_DRAFT = `
mutation CreateWorkflowVersionDraft($input: CreateWorkflowVersionDraftInput!) {
  createWorkflowVersionDraft(input: $input) { workflowVersion { draftRevision } }
}`;

const SAVE_WORKFLOW_DRAFT = `
mutation SaveWorkflowVersionDraft($input: SaveWorkflowVersionDraftInput!) {
  saveWorkflowVersionDraft(input: $input) {
    workflowVersion { draftRevision }
    validation { errors { code stepKey message } }
  }
}`;

const PUBLISH_WORKFLOW = `
mutation PublishWorkflowVersion($input: PublishWorkflowVersionInput!) {
  publishWorkflowVersion(input: $input) { workflowVersion { version } }
}`;

const BIND_FORM_WORKFLOW = `
mutation BindFormWorkflow($input: BindFormWorkflowInput!) {
  bindFormWorkflow(input: $input) { form { key } }
}`;

const CREATE_FORM_DRAFT = `
mutation CreateFormDraft($input: CreateFormDraftInput!) {
  createFormDraft(input: $input) { submission { id editVersion } }
}`;

const SAVE_FORM_DRAFT = `
mutation SaveFormDraft($input: SaveFormDraftInput!) {
  saveFormDraft(input: $input) { submission { id editVersion } }
}`;

const SUBMISSION_FIELDS = `
  id status revision editVersion currentInstanceId blocked replacedById copiedFrom
  summary { title }`;

const SUBMIT_FORM_SUBMISSION = `
mutation SubmitFormSubmission($input: SubmitFormSubmissionInput!) {
  submitFormSubmission(input: $input) { submission { ${SUBMISSION_FIELDS} } }
}`;

const FORM_SUBMISSION = `
query FormSubmission($id: ID!) {
  formSubmission(id: $id) { submission { ${SUBMISSION_FIELDS} } }
}`;

const TASK_FIELDS = `
  id instanceId submissionId stepKey stepName taskKey status editVersion`;

const MY_TASKS = `
query MyTasks($input: MyTasksInput!) {
  myTasks(input: $input) { items { ${TASK_FIELDS} } }
}`;

const DECIDE_TASK = `
mutation DecideTask($input: DecideTaskInput!) {
  decideTask(input: $input) { task { ${TASK_FIELDS} } result }
}`;

const WORKFLOW_INSTANCE = `
query WorkflowInstance($id: ID!) {
  workflowInstance(id: $id) {
    instance {
      id status activeStepKeys
      steps { stepKey status blocked plan { taskKey assigneeState assignee { id } previousAssignees { id } } }
    }
  }
}`;

const MY_TASKS_ON_INSTANCE = `
query MyTasksOnInstance($id: ID!) {
  workflowInstance(id: $id) { instance { myTasks { taskKey status } } }
}`;

const SET_USER_ENABLED = `
mutation SetUserEnabled($input: SetUserEnabledInput!) {
  setUserEnabled(input: $input) { user { id enabled } }
}`;

/* ---- 型別 ---- */

export interface WorkflowSubmission {
  id: string;
  status: string;
  revision: number;
  editVersion: number;
  currentInstanceId: string | null;
  blocked: boolean;
  replacedById: string | null;
  copiedFrom: string | null;
  summary: { title: string | null } | null;
}

export interface WorkflowTask {
  id: string;
  instanceId: string;
  submissionId: string;
  stepKey: string;
  stepName: string;
  taskKey: string;
  status: string;
  editVersion: number;
}

export interface WorkflowInstance {
  id: string;
  status: string;
  activeStepKeys: string[];
  steps: {
    stepKey: string;
    status: string;
    blocked: boolean;
    plan: {
      taskKey: string;
      assigneeState: string;
      assignee: { id: string };
      /** 被改派走的人(依改派順序) */
      previousAssignees: { id: string }[];
    }[];
  }[];
}

/** 流程定義的一關(`StepDef` 的 JSON;形狀正本 `@repo/domain/workflow`)。 */
export type StepJson = Record<string, unknown>;

export interface WorkflowDefinitionJson {
  steps: StepJson[];
  edges: { from: string; to: string }[] | null;
  /** 整個流程的知會對象(B17;單據完成 / 駁回 / 作廢時通知);省略 = 不知會。 */
  cc?: Record<string, unknown> | null;
}

export type DecisionName = "APPROVE" | "REJECT" | "RETURN";

/* ---- 組織主管 ---- */

export async function setOrgManagers(
  accessToken: string,
  orgId: string,
  userIds: readonly string[],
): Promise<void> {
  await graphqlOk(
    SET_ORG_MANAGERS,
    { input: { orgId, userIds: [...userIds] } },
    accessToken,
  );
}

/* ---- 表單(root 建共用、發布、分派) ---- */

export async function publishSharedFormIn(
  rootToken: string,
  input: {
    key: string;
    name: string;
    moduleKey: string;
    definition: Record<string, unknown>;
    tenantOrgIds: readonly string[];
  },
): Promise<void> {
  await graphqlOk(
    CREATE_FORM,
    {
      input: { key: input.key, moduleKey: input.moduleKey, name: input.name },
    },
    rootToken,
  );
  const draft = await graphqlOk<{
    createFormVersionDraft: { formVersion: { draftRevision: number } };
  }>(CREATE_FORM_VERSION_DRAFT, { input: { formKey: input.key } }, rootToken);
  const saved = await graphqlOk<{
    saveFormVersionDraft: { formVersion: { draftRevision: number } };
  }>(
    SAVE_FORM_VERSION_DRAFT,
    {
      input: {
        formKey: input.key,
        expectedDraftRevision:
          draft.createFormVersionDraft.formVersion.draftRevision,
        ...input.definition,
      },
    },
    rootToken,
  );
  await graphqlOk(
    PUBLISH_FORM_VERSION,
    {
      input: {
        formKey: input.key,
        expectedDraftRevision:
          saved.saveFormVersionDraft.formVersion.draftRevision,
        changelog: "e2e 前置",
      },
    },
    rootToken,
  );
  await graphqlOk(
    ASSIGN_FORM_TO_TENANTS,
    { input: { formKey: input.key, tenantOrgIds: [...input.tenantOrgIds] } },
    rootToken,
  );
}

/* ---- 流程(租戶管理員建客製、發布、綁定) ---- */

/** 站在租戶內建流程 = 客製流程(自動分派給自己)→ 開草稿 → 存定義 → 發布 → 綁到表單。 */
export async function publishCustomWorkflow(
  tenantToken: string,
  input: {
    key: string;
    name: string;
    definition: WorkflowDefinitionJson;
    bindFormKey: string;
  },
): Promise<void> {
  await graphqlOk(
    CREATE_WORKFLOW,
    { input: { key: input.key, name: input.name } },
    tenantToken,
  );
  const draft = await graphqlOk<{
    createWorkflowVersionDraft: { workflowVersion: { draftRevision: number } };
  }>(CREATE_WORKFLOW_DRAFT, { input: { workflowKey: input.key } }, tenantToken);
  const saved = await graphqlOk<{
    saveWorkflowVersionDraft: {
      workflowVersion: { draftRevision: number };
      validation: { errors: { code: string; message: string }[] } | null;
    };
  }>(
    SAVE_WORKFLOW_DRAFT,
    {
      input: {
        workflowKey: input.key,
        expectedDraftRevision:
          draft.createWorkflowVersionDraft.workflowVersion.draftRevision,
        definition: input.definition,
      },
    },
    tenantToken,
  );
  const errors = saved.saveWorkflowVersionDraft.validation?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `流程定義有錯:${errors.map((error) => error.message).join("; ")}`,
    );
  }
  await graphqlOk(
    PUBLISH_WORKFLOW,
    {
      input: {
        workflowKey: input.key,
        expectedDraftRevision:
          saved.saveWorkflowVersionDraft.workflowVersion.draftRevision,
        changelog: "e2e 前置",
      },
    },
    tenantToken,
  );
  await graphqlOk(
    BIND_FORM_WORKFLOW,
    { input: { formKey: input.bindFormKey, workflowKey: input.key } },
    tenantToken,
  );
}

/* ---- 送出與審核 ---- */

/** 建草稿並送出(綁了流程 → 直接進審核)。 */
export async function submitForm(
  accessToken: string,
  formKey: string,
  values: Record<string, unknown>,
): Promise<WorkflowSubmission> {
  const draft = await graphqlOk<{
    createFormDraft: { submission: { id: string; editVersion: number } };
  }>(
    CREATE_FORM_DRAFT,
    {
      input: {
        formKey,
        clientRequestId: `e2e-${formKey}-${randomUUID()}`,
        values,
      },
    },
    accessToken,
  );
  return submitExisting(
    accessToken,
    draft.createFormDraft.submission.id,
    draft.createFormDraft.submission.editVersion,
  );
}

/** 改內容(草稿 / 退回 / 撤回的單)。 */
export async function saveFormDraft(
  accessToken: string,
  id: string,
  expectedEditVersion: number,
  values: Record<string, unknown>,
): Promise<{ id: string; editVersion: number }> {
  const data = await graphqlOk<{
    saveFormDraft: { submission: { id: string; editVersion: number } };
  }>(
    SAVE_FORM_DRAFT,
    { input: { id, expectedEditVersion, values } },
    accessToken,
  );
  return data.saveFormDraft.submission;
}

export async function submitExisting(
  accessToken: string,
  id: string,
  expectedEditVersion: number,
): Promise<WorkflowSubmission> {
  const data = await graphqlOk<{
    submitFormSubmission: { submission: WorkflowSubmission };
  }>(
    SUBMIT_FORM_SUBMISSION,
    { input: { id, expectedEditVersion } },
    accessToken,
  );
  return data.submitFormSubmission.submission;
}

export async function formSubmission(
  accessToken: string,
  id: string,
): Promise<WorkflowSubmission> {
  const data = await graphqlOk<{
    formSubmission: { submission: WorkflowSubmission };
  }>(FORM_SUBMISSION, { id }, accessToken);
  return data.formSubmission.submission;
}

/** 某人在某個實例上的任務與狀態(含已取消的;「待我審核」清單不列取消的)。 */
export async function myTasksOnInstance(
  accessToken: string,
  instanceId: string,
): Promise<{ taskKey: string; status: string }[]> {
  const data = await graphqlOk<{
    workflowInstance: {
      instance: { myTasks: { taskKey: string; status: string }[] };
    };
  }>(MY_TASKS_ON_INSTANCE, { id: instanceId }, accessToken);
  return data.workflowInstance.instance.myTasks;
}

export async function myTasks(
  accessToken: string,
  done = false,
): Promise<WorkflowTask[]> {
  const data = await graphqlOk<{ myTasks: { items: WorkflowTask[] } }>(
    MY_TASKS,
    { input: { done, pageSize: 100 } },
    accessToken,
  );
  return data.myTasks.items;
}

/** 某人在某筆提交上待處理的任務(沒有就拋:前置失敗要當場炸)。 */
export async function pendingTaskOf(
  accessToken: string,
  submissionId: string,
): Promise<WorkflowTask> {
  const tasks = await myTasks(accessToken);
  const task = tasks.find((item) => item.submissionId === submissionId);
  if (task === undefined) {
    throw new Error(`沒有提交 ${submissionId} 的待處理任務`);
  }
  return task;
}

export async function decideTask(
  accessToken: string,
  task: Pick<WorkflowTask, "id" | "editVersion">,
  decision: DecisionName,
  comment: string | null = decision === "APPROVE" ? null : "e2e 理由",
): Promise<string> {
  const data = await graphqlOk<{ decideTask: { result: string } }>(
    DECIDE_TASK,
    {
      input: {
        taskId: task.id,
        expectedEditVersion: task.editVersion,
        decision,
        comment,
      },
    },
    accessToken,
  );
  return data.decideTask.result;
}

/** 找到某人在某筆提交上的待處理任務並核准。 */
export async function approveAs(
  accessToken: string,
  submissionId: string,
): Promise<void> {
  await decideTask(
    accessToken,
    await pendingTaskOf(accessToken, submissionId),
    "APPROVE",
  );
}

export async function workflowInstance(
  accessToken: string,
  id: string,
): Promise<WorkflowInstance> {
  const data = await graphqlOk<{
    workflowInstance: { instance: WorkflowInstance };
  }>(WORKFLOW_INSTANCE, { id }, accessToken);
  return data.workflowInstance.instance;
}

/** 停用 / 啟用使用者(審核者失效 hook 由它觸發)。 */
export function setUserEnabled(
  accessToken: string,
  id: string,
  enabled: boolean,
): Promise<GraphqlResponse<unknown>> {
  return graphql(SET_USER_ENABLED, { input: { id, enabled } }, accessToken);
}

/** 某筆提交目前的狀態(`REVIEWING` / `COMPLETED`…)。 */
export async function submissionStatus(
  accessToken: string,
  id: string,
): Promise<string> {
  const submission = await formSubmission(accessToken, id);
  return submission.status;
}

/** 某人待處理任務的提交 id。 */
export async function taskSubmissionIds(
  accessToken: string,
): Promise<string[]> {
  const tasks = await myTasks(accessToken);
  return tasks.map((task) => task.submissionId);
}

/* ---- 劇本 25–29:改派、作廢、代理人、通知 ---- */

const REASSIGN_TASK = `
mutation ReassignTask($input: ReassignTaskInput!) {
  reassignTask(input: $input) { task { id } }
}`;

const VOID_SUBMISSION = `
mutation VoidSubmission($input: VoidSubmissionInput!) {
  voidSubmission(input: $input) { submission { id status } }
}`;

const CREATE_MY_DELEGATION = `
mutation CreateMyDelegation($input: CreateMyDelegationInput!) {
  createMyDelegation(input: $input) { delegation { id status } }
}`;

const MY_NOTIFICATIONS = `
query MyNotifications($input: MyNotificationsInput!) {
  myNotifications(input: $input) {
    items { id type title body refId readAt }
    unreadCount
  }
}`;

/** 流程管理者把某張任務改派給另一個人(不必是阻擋中的任務)。 */
export async function reassignTask(
  accessToken: string,
  taskId: string,
  toUserId: string,
): Promise<void> {
  await graphqlOk(REASSIGN_TASK, { input: { taskId, toUserId } }, accessToken);
}

/** 申請人作廢自己已完成的單(理由必填)。 */
export async function voidSubmission(
  accessToken: string,
  id: string,
  reason: string,
): Promise<void> {
  const current = await formSubmission(accessToken, id);
  await graphqlOk(
    VOID_SUBMISSION,
    { input: { id, expectedEditVersion: current.editVersion, reason } },
    accessToken,
  );
}

/** 設定自己的代理人(起訖是時點;只讀寫自己的)。 */
export async function createMyDelegation(
  accessToken: string,
  input: { delegateUserId: string; startAt: Date; endAt: Date },
): Promise<string> {
  const data = await graphqlOk<{
    createMyDelegation: { delegation: { id: string } };
  }>(
    CREATE_MY_DELEGATION,
    {
      input: {
        delegateUserId: input.delegateUserId,
        startAt: input.startAt.toISOString(),
        endAt: input.endAt.toISOString(),
        note: null,
      },
    },
    accessToken,
  );
  return data.createMyDelegation.delegation.id;
}

export interface NotificationEntry {
  id: string;
  type: string;
  title: string;
  body: string;
  refId: string | null;
  readAt: string | null;
}

/** 我的通知(依時間新到舊,一次 100 則;劇本裡的人通知不會超過這個數)。 */
export async function myNotifications(
  accessToken: string,
): Promise<{ items: NotificationEntry[]; unreadCount: number }> {
  const data = await graphqlOk<{
    myNotifications: { items: NotificationEntry[]; unreadCount: number };
  }>(MY_NOTIFICATIONS, { input: { page: 1, pageSize: 100 } }, accessToken);
  return data.myNotifications;
}

/** 某人收到的某類型通知、內容(標題 + 內文)含某段字的那幾則。 */
export async function notificationsMatching(
  accessToken: string,
  type: string,
  text: string,
): Promise<NotificationEntry[]> {
  const { items } = await myNotifications(accessToken);
  return items.filter(
    (item) =>
      item.type === type && `${item.title}\n${item.body}`.includes(text),
  );
}
