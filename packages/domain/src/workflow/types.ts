/**
 * 審核流程的型別(語意正本見 Spec 6b §4、§5 與 `docs/data-model.md`「workflow_*」)。
 * 純型別,前後端共用:api 存取與推進、admin 設計器與審核區塊都吃同一份。
 *
 * id 一律是字串(domain 不認得 ObjectId);api 讀出文件後轉成字串再交給本套件的函式。
 */
import type { Audience } from "../audience/types";
import type { Expression } from "../form/types";

// ---- 版本定義(`workflow_versions.steps[]` / `edges[]`) ----

/** 節點種類:`review` = 審核關卡(預設);`join` = 系統匯合節點(不派人、不能被跳過)。 */
export const STEP_KINDS = ["review", "join"] as const;

export type StepKind = (typeof STEP_KINDS)[number];

/** 會簽模式:`any` 一人核准即過、一人駁回即駁回;`all` 全部核准才過、一人駁回即駁回。 */
export const APPROVAL_MODES = ["any", "all"] as const;

export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** 審核者來源的三種(《底座規格》3.3):人員條件 / 表單欄位 / 主管。 */
export const ASSIGNEE_KINDS = ["audience", "field", "manager"] as const;

export type AssigneeKind = (typeof ASSIGNEE_KINDS)[number];

/** 審核者來源;進到該關時解析一次,寫進派任計畫後不再重算。 */
export type AssigneeSource =
  /**
   * 人員條件(取代原本的「指定使用者」與「角色」;格式正本 `@repo/domain/audience`,
   * 一定是 `match`):使用處的選項見 `approver-audience.ts`
   */
  | { kind: "audience"; audience: Audience }
  /** 表單欄位:提交該修訂 `values[fieldKey]`(`reference(user)`)指到的人 */
  | { kind: "field"; formKey: string; fieldKey: string }
  /** 主管:從提交所屬組織往上第 `level` 組主管(1 起) */
  | { kind: "manager"; level: number };

/** 「申請人屬於這些組織」的「租戶」特殊值(不是組織 id;畫面顯示「最上層組織」)。 */
export const SKIP_ORG_TENANT = "tenant";

/**
 * 「申請人屬於這些組織就跳過」(《底座規格》3.4 B4):比對申請人送出當下的**所屬組織(全部)**
 * (修訂 `ctx` 快照的 `orgIds`),任一個在名單裡(勾「包含下層」時含名單組織的下層)就成立。
 * 共用流程只能用 `SKIP_ORG_TENANT`;指定組織只能用在租戶客製流程。
 */
export interface SkipOrgsDef {
  /** 組織 id 或 `SKIP_ORG_TENANT`;至少一個。 */
  orgIds: string[];
  /** 包含下層。 */
  includeDescendants: boolean;
}

/**
 * 自動通過(《底座規格》3.5 B5;兩項各自開關,省略 = 照常審核):
 * - `applicant`:申請人是這一關的審核者 → 記成申請人核准(預設照常 = 剔除申請人)
 * - `priorApprover`:審核者已在**這一輪**(同一實例)更早的關卡親自核准過 → 記成他核准
 *
 * 兩種都照樣經 `beforeApprove`;被擋下就留給他照常審核。
 */
export interface AutoApproveDef {
  applicant?: boolean;
  priorApprover?: boolean;
}

/** 審核關卡(`kind` 省略 = `review`)。 */
export interface ReviewStepDef {
  key: string;
  name: string;
  kind?: "review";
  assignee: AssigneeSource;
  mode: ApprovalMode;
  /**
   * 跳過條件(6a 表達式;畫面上的「符合條件」);成立 → 整關跳過;沒設 → 不看公式。
   * 與 `skipOrgs` 任一項成立就跳過。
   */
  skipWhen?: Expression | null;
  /** 申請人屬於這些組織就跳過(畫面上的「申請人屬於這些組織」);沒設 → 不看組織。 */
  skipOrgs?: SkipOrgsDef | null;
  /** 自動通過;沒設 = 兩項都照常審核。 */
  autoApprove?: AutoApproveDef | null;
  /** 審核者可否「退回修改」;省略 = true。 */
  allowReturn?: boolean;
}

/** 審核關卡才有的屬性(匯合節點帶了任一個 → `JOIN_HAS_REVIEW_PROPS`)。 */
export const REVIEW_STEP_PROPS = [
  "assignee",
  "mode",
  "skipWhen",
  "skipOrgs",
  "autoApprove",
  "allowReturn",
] as const;

/** 系統匯合節點:沒有 `REVIEW_STEP_PROPS` 的任何一個。 */
export interface JoinStepDef {
  key: string;
  name: string;
  kind: "join";
}

export type StepDef = ReviewStepDef | JoinStepDef;

/** 連線(關卡 key → 關卡 key);6b 不帶條件。 */
export interface WorkflowEdge {
  from: string;
  to: string;
}

/**
 * 一版流程定義(`workflow_versions` 裡檢查器與推進要的兩塊)。
 * **沒有 `edges`(或為空陣列)= 直線**:`steps[]` 的順序就是流程;有 `edges` 才是圖。
 */
export interface WorkflowDefinition {
  steps: StepDef[];
  edges?: WorkflowEdge[] | null;
}

export function isJoinStep(step: StepDef): step is JoinStepDef {
  return step.kind === "join";
}

export function isReviewStep(step: StepDef): step is ReviewStepDef {
  return step.kind !== "join";
}

/** 關卡的 `allowReturn`(省略 = true);匯合節點沒有審核者,永遠 false。 */
export function allowsReturn(step: StepDef): boolean {
  return isReviewStep(step) && step.allowReturn !== false;
}

// ---- 實例(`workflow_instances`,唯一權威) ----

/** 實例狀態(Spec §4、§6)。 */
export const INSTANCE_STATUSES = [
  "running",
  "blocked",
  "approved",
  "rejected",
  "returned",
  "withdrawn",
  "superseded",
] as const;

export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

/** 還在跑的兩種(所有啟動節點的 CAS 都帶這個條件)。 */
export const LIVE_INSTANCE_STATUSES = [
  "running",
  "blocked",
] as const satisfies readonly InstanceStatus[];

/** 終局的五種(列 2 / 3)。 */
export const TERMINAL_INSTANCE_STATUSES = [
  "approved",
  "rejected",
  "returned",
  "withdrawn",
  "superseded",
] as const satisfies readonly InstanceStatus[];

export type TerminalInstanceStatus =
  (typeof TERMINAL_INSTANCE_STATUSES)[number];

export function isTerminalInstanceStatus(
  status: InstanceStatus,
): status is TerminalInstanceStatus {
  return (TERMINAL_INSTANCE_STATUSES as readonly string[]).includes(status);
}

export function isLiveInstanceStatus(status: InstanceStatus): boolean {
  return (LIVE_INSTANCE_STATUSES as readonly string[]).includes(status);
}

/** 關卡在實例內的狀態。 */
export const STEP_STATUSES = [
  "pending",
  "skipped",
  "active",
  "completed",
  "terminated",
] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

/** 派任計畫一項的承辦人狀態:`invalid` = 停用 / 移出租戶(等改派)。 */
export const ASSIGNEE_STATES = ["active", "invalid"] as const;

export type AssigneeState = (typeof ASSIGNEE_STATES)[number];

/** 派任計畫的一項;`taskKey = "<stepKey>-<seq>"`,改派不變。 */
export interface PlanItem {
  taskKey: string;
  assigneeId: string;
  previousAssigneeIds: string[];
  assigneeState: AssigneeState;
}

/** 審核決定(存值與任務狀態同名,方便投影)。 */
export const DECISIONS = ["approved", "rejected", "returned"] as const;

export type Decision = (typeof DECISIONS)[number];

/** 終局決定(寫進 `outcome` 的兩種)。 */
export type TerminalDecision = Exclude<Decision, "approved">;

/** 已接受的決定;陣列順序 = 接受順序;每個 `taskKey` 最多一筆。 */
export interface AcceptedDecision {
  taskKey: string;
  userId: string;
  decision: Decision;
  comment: string | null;
  at: Date;
}

/**
 * `steps[]` 的一筆(以 `stepKey` 對應版本的節點;實例內唯一、不可變)。
 * **實例建立時就為每個節點建一筆 `pending`**(`initialStepStates`),之後只改欄位不增刪元素 ——
 * 推進的 CAS 條件是對陣列元素下的,元素不存在條件就永遠不成立。
 */
export interface StepState {
  stepKey: string;
  status: StepStatus;
  blocked: boolean;
  plan: PlanItem[];
  decisions: AcceptedDecision[];
}

/** 歷程事件種類(Spec §4 `history[]`)。 */
export const HISTORY_KINDS = [
  "started",
  "step_entered",
  "step_skipped",
  "task_created",
  "approved",
  "rejected",
  "returned",
  "late",
  "step_completed",
  "join_waiting",
  "blocked",
  "unblocked",
  "reassigned",
  "assignee_added",
  "withdrawn",
  "completed",
  "notified",
  "superseded",
  "advance_retried",
  "auto_approve_blocked",
] as const;

export type HistoryKind = (typeof HISTORY_KINDS)[number];

/**
 * 歷程事件的原因(時間軸顯示「是哪一項成立」):
 * - `step_skipped`:`skip_orgs`(申請人屬於指定組織)/ `skip_condition`(符合條件)
 * - `approved`:`auto_applicant`(申請人是審核者,自動通過)/ `auto_prior_approver`(已在前關核准,自動通過)
 * - `auto_approve_blocked`(B5 自動通過被 `beforeApprove` 擋下):同上兩個值,表示是哪一種自動通過沒成立
 *
 * 其他事件與人按的核准沒有原因(null)。
 */
export const HISTORY_REASONS = [
  "skip_orgs",
  "skip_condition",
  "auto_applicant",
  "auto_prior_approver",
] as const;

export type HistoryReason = (typeof HISTORY_REASONS)[number];

/** 跳過的原因(`step_skipped` 帶)。 */
export type SkipReason = Extract<HistoryReason, "skip_orgs" | "skip_condition">;

/** 自動通過的原因(自動記的 `approved` 帶)。 */
export type AutoApproveReason = Extract<
  HistoryReason,
  "auto_applicant" | "auto_prior_approver"
>;

/** 結果通知的種類(`notified` 事件帶它,與流程完成事件 `completed` 分開)。 */
export type NotifiedResult = "approved" | "rejected" | "returned";

export interface HistoryEvent {
  at: Date;
  kind: HistoryKind;
  stepKey?: string | null;
  taskKey?: string | null;
  userId?: string | null;
  toUserId?: string | null;
  comment?: string | null;
  /** 只有 `notified`:這次通知的結果種類。 */
  result?: NotifiedResult | null;
  /** 跳過 / 自動通過的原因(見 `HISTORY_REASONS`);其他 null。 */
  reason?: HistoryReason | null;
  /** 只有 `auto_approve_blocked`:守門擋下的專案錯誤碼(admin 以 `admin.lifecycle.<碼>` 顯示)。 */
  code?: string | null;
}

/** 全案終局採用的那一筆決定(只能從 null 寫成有值一次)。 */
export interface InstanceOutcome {
  kind: TerminalDecision;
  stepKey: string;
  taskKey: string;
  /** 該決定被接受時同一次原子追加的 `history` 事件序號 = 接受順序。 */
  historyIndex: number;
}

/** 推進要讀的實例欄位(api 讀出文件後轉成這個形狀)。 */
export interface InstanceSnapshot {
  id: string;
  status: InstanceStatus;
  /** 申請人(提交的 `createdBy`);自審剔除用。 */
  createdBy: string;
  submissionId: string;
  revision: number;
  activeStepKeys: string[];
  steps: StepState[];
  editVersion: number;
  outcome: InstanceOutcome | null;
  history: HistoryEvent[];
  finishedAt: Date | null;
}

// ---- 任務(`workflow_tasks`,投影) ----

export const TASK_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "returned",
  "late",
  "cancelled",
  "blocked",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 推進要比對的任務欄位。 */
export interface TaskSnapshot {
  stepKey: string;
  taskKey: string;
  status: TaskStatus;
  assigneeId: string;
  previousAssigneeIds: string[];
  decidedAt: Date | null;
  comment: string | null;
}

/** 任務投影該有的樣子(列 7 的任務投影規則算出來的)。 */
export interface TaskProjection {
  status: TaskStatus;
  assigneeId: string;
  previousAssigneeIds: string[];
  decidedAt: Date | null;
  comment: string | null;
}

// ---- 提交(`form_submissions` 的 6b 欄位) ----

/** 提交狀態(6a 擴充,Spec §6)。 */
export const SUBMISSION_STATUSES = [
  "draft",
  "reviewing",
  "returned",
  "withdrawn",
  "completed",
  "rejected",
  "voided",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** 推進判斷「有沒有資格同步提交」要讀的提交欄位。 */
export interface SubmissionSnapshot {
  id: string;
  status: SubmissionStatus;
  revision: number;
  currentInstanceId: string | null;
  blocked: boolean;
}
