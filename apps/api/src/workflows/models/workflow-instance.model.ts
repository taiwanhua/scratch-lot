import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

import {
  FormSubmissionSummary,
  FormUserRef,
} from "../../forms/models/form-common.model";

/** 實例狀態(成員值即落庫字串;Spec 6b §4)。 */
export enum WorkflowInstanceStatusEnum {
  RUNNING = "running",
  BLOCKED = "blocked",
  APPROVED = "approved",
  REJECTED = "rejected",
  RETURNED = "returned",
  WITHDRAWN = "withdrawn",
  SUPERSEDED = "superseded",
}

registerEnumType(WorkflowInstanceStatusEnum, {
  name: "WorkflowInstanceStatus",
  description:
    "流程實例狀態:審核中 / 阻擋 / 核准 / 駁回 / 退回 / 撤回 / 被取代",
});

/** 關卡在實例內的狀態。 */
export enum WorkflowStepStatusEnum {
  PENDING = "pending",
  SKIPPED = "skipped",
  ACTIVE = "active",
  COMPLETED = "completed",
  TERMINATED = "terminated",
}

registerEnumType(WorkflowStepStatusEnum, {
  name: "WorkflowStepStatus",
  description: "關卡狀態:還沒進 / 跳過 / 進行中 / 完成 / 被終止",
});

/** 審核任務狀態(投影;Spec 6b §6「任務狀態」)。 */
export enum WorkflowTaskStatusEnum {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  RETURNED = "returned",
  LATE = "late",
  CANCELLED = "cancelled",
  BLOCKED = "blocked",
}

registerEnumType(WorkflowTaskStatusEnum, {
  name: "WorkflowTaskStatus",
  description:
    "任務狀態:待處理 / 核准 / 駁回 / 退回 / 晚到(不影響結果)/ 取消 / 承辦人失效",
});

/** 審核決定(`decideTask` 的輸入)。 */
export enum WorkflowDecisionEnum {
  APPROVE = "approve",
  REJECT = "reject",
  RETURN = "return",
}

registerEnumType(WorkflowDecisionEnum, {
  name: "WorkflowDecision",
  description: "核准 / 駁回(理由必填)/ 退回修改(理由必填,該關要允許退回)",
});

/** `decideTask` 的結果:決定被寫進實例 / 關卡已結束或任務已變更(任務不動)。 */
export enum WorkflowDecideResultEnum {
  ACCEPTED = "accepted",
  STEP_CLOSED = "stepClosed",
}

registerEnumType(WorkflowDecideResultEnum, {
  name: "WorkflowDecideResult",
  description: "決定被接受 / 此關已結束或任務已變更(前端提示並重載)",
});

@ObjectType()
export class WorkflowPlanItemModel {
  @Field(() => String)
  taskKey!: string;

  @Field(() => FormUserRef)
  assignee!: FormUserRef;

  /** 被改派走的人(依改派順序)。 */
  @Field(() => [FormUserRef])
  previousAssignees!: FormUserRef[];

  /** `invalid` = 承辦人停用 / 移出租戶(等改派)。 */
  @Field(() => String)
  assigneeState!: string;

  /**
   * 這一項對應的任務 id(`reassignTask` 要它)。**只給流程管理者**(`abilities.canManage`):
   * 阻擋清單要對別人的任務改派;其他讀者一律 null,任務還沒建出來(計畫剛寫入)也是 null。
   */
  @Field(() => ID, { nullable: true })
  taskId!: string | null;
}

@ObjectType()
export class WorkflowDecisionModel {
  @Field(() => String)
  taskKey!: string;

  @Field(() => FormUserRef)
  user!: FormUserRef;

  /** `approved` / `rejected` / `returned`。 */
  @Field(() => String)
  decision!: string;

  @Field(() => String, { nullable: true })
  comment!: string | null;

  @Field(() => GraphQLISODateTime)
  at!: Date;
}

/** 實例裡的一個節點(版本的每一關各一筆;分支進度由它們組成)。 */
@ObjectType()
export class WorkflowInstanceStepModel {
  @Field(() => String)
  stepKey!: string;

  @Field(() => String)
  name!: string;

  /** `review` / `join`。 */
  @Field(() => String)
  kind!: string;

  /** 審核關卡的會簽模式(`any` / `all`);匯合節點為 null。 */
  @Field(() => String, { nullable: true })
  mode!: string | null;

  /** 這一關可否「退回修改」(版本定義的 `allowReturn`,省略 = true);匯合節點為 false。 */
  @Field(() => Boolean)
  allowReturn!: boolean;

  @Field(() => WorkflowStepStatusEnum)
  status!: WorkflowStepStatusEnum;

  @Field(() => Boolean)
  blocked!: boolean;

  @Field(() => [WorkflowPlanItemModel])
  plan!: WorkflowPlanItemModel[];

  /** 已接受的決定(依接受順序)。 */
  @Field(() => [WorkflowDecisionModel])
  decisions!: WorkflowDecisionModel[];
}

@ObjectType()
export class WorkflowHistoryEventModel {
  @Field(() => GraphQLISODateTime)
  at!: Date;

  @Field(() => String)
  kind!: string;

  @Field(() => String, { nullable: true })
  stepKey!: string | null;

  @Field(() => String, { nullable: true })
  taskKey!: string | null;

  @Field(() => FormUserRef, { nullable: true })
  user!: FormUserRef | null;

  @Field(() => FormUserRef, { nullable: true })
  toUser!: FormUserRef | null;

  @Field(() => String, { nullable: true })
  comment!: string | null;

  /** 只有 `notified`:結果通知的種類。 */
  @Field(() => String, { nullable: true })
  result!: string | null;

  /**
   * 跳過 / 自動通過的原因(`@repo/domain/workflow` 的 `HISTORY_REASONS`):`step_skipped` 帶
   * `skip_orgs`(申請人屬於指定組織)/ `skip_condition`(符合條件);B5 自動記的 `approved` 帶
   * `auto_applicant` / `auto_prior_approver`;`auto_approve_blocked` 帶同兩值(哪一種自動通過沒成立)。其他事件 null。
   */
  @Field(() => String, { nullable: true })
  reason!: string | null;

  /** 只有 `auto_approve_blocked`:守門擋下的專案錯誤碼(admin 以 `admin.lifecycle.<碼>` 顯示)。 */
  @Field(() => String, { nullable: true })
  code!: string | null;
}

@ObjectType()
export class WorkflowOutcomeModel {
  /** `rejected` / `returned`。 */
  @Field(() => String)
  kind!: string;

  @Field(() => String)
  stepKey!: string;

  @Field(() => String)
  taskKey!: string;
}

/** 審核任務(`workflow_tasks` 投影 + 實例快照的摘要)。 */
@ObjectType()
export class WorkflowTaskModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  instanceId!: string;

  @Field(() => ID)
  submissionId!: string;

  /** 這個任務審的修訂號(讀提交要帶 `formSubmission(id, revision)`)。 */
  @Field(() => Int)
  revision!: number;

  @Field(() => String)
  moduleKey!: string;

  @Field(() => String, { nullable: true })
  moduleName!: string | null;

  @Field(() => ID)
  formKey!: string;

  @Field(() => String, { nullable: true })
  formName!: string | null;

  @Field(() => String)
  stepKey!: string;

  @Field(() => String)
  stepName!: string;

  @Field(() => String)
  taskKey!: string;

  @Field(() => WorkflowTaskStatusEnum)
  status!: WorkflowTaskStatusEnum;

  @Field(() => FormUserRef)
  assignee!: FormUserRef;

  /** 申請人(實例的建立者)。 */
  @Field(() => FormUserRef, { nullable: true })
  applicant!: FormUserRef | null;

  /** **實例上的**標題槽快照(不讀提交最新的摘要;單據重送後仍是這個修訂的標題)。 */
  @Field(() => FormSubmissionSummary, { nullable: true })
  summary!: FormSubmissionSummary | null;

  @Field(() => WorkflowInstanceStatusEnum)
  instanceStatus!: WorkflowInstanceStatusEnum;

  @Field(() => GraphQLISODateTime, { nullable: true })
  decidedAt!: Date | null;

  @Field(() => String, { nullable: true })
  comment!: string | null;

  /** 送決定時帶它當 `expectedEditVersion`(只擋同一個人兩個分頁重複送)。 */
  @Field(() => Int)
  editVersion!: number;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

/** 這位讀者對這個實例能做什麼(**含權限**,前端直接用)。 */
@ObjectType()
export class WorkflowInstanceAbilities {
  /** 申請人本人、實例進行中、還沒有任何被接受的決定。 */
  @Field(() => Boolean)
  canWithdraw!: boolean;

  /** 流程管理者(`system.workflows.blocked-page.reassign`):改派 / 新增審核者 / 重試推進。 */
  @Field(() => Boolean)
  canManage!: boolean;
}

/** 流程實例(審核區塊 / 申請中心詳情 / 阻擋清單;不含提交內容)。 */
@ObjectType()
export class WorkflowInstanceModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  submissionId!: string;

  @Field(() => Int)
  revision!: number;

  @Field(() => String)
  moduleKey!: string;

  @Field(() => String, { nullable: true })
  moduleName!: string | null;

  @Field(() => ID)
  formKey!: string;

  @Field(() => String, { nullable: true })
  formName!: string | null;

  @Field(() => Int)
  formVersion!: number;

  @Field(() => ID)
  workflowKey!: string;

  @Field(() => String, { nullable: true })
  workflowName!: string | null;

  @Field(() => Int)
  workflowVersion!: number;

  @Field(() => WorkflowInstanceStatusEnum)
  status!: WorkflowInstanceStatusEnum;

  /** 該修訂的摘要槽快照。 */
  @Field(() => FormSubmissionSummary, { nullable: true })
  summary!: FormSubmissionSummary | null;

  @Field(() => FormUserRef, { nullable: true })
  applicant!: FormUserRef | null;

  /** 目前進行中的關卡(平行時多個)。 */
  @Field(() => [String])
  activeStepKeys!: string[];

  /** 全部節點(依版本定義的順序)。 */
  @Field(() => [WorkflowInstanceStepModel])
  steps!: WorkflowInstanceStepModel[];

  @Field(() => [WorkflowHistoryEventModel])
  history!: WorkflowHistoryEventModel[];

  @Field(() => WorkflowOutcomeModel, { nullable: true })
  outcome!: WorkflowOutcomeModel | null;

  /** 撤回帶它當預期值之外,前端判斷「資料變了」用。 */
  @Field(() => Int)
  editVersion!: number;

  /** 讀者自己在這個實例的任務(待我審核的動作鈕用)。 */
  @Field(() => [WorkflowTaskModel])
  myTasks!: WorkflowTaskModel[];

  @Field(() => WorkflowInstanceAbilities)
  abilities!: WorkflowInstanceAbilities;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  finishedAt!: Date | null;
}

@ObjectType()
export class WorkflowInstancePayload {
  @Field(() => WorkflowInstanceModel)
  instance!: WorkflowInstanceModel;
}

@ObjectType()
export class WorkflowInstancesPayload {
  @Field(() => [WorkflowInstanceModel])
  items!: WorkflowInstanceModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;

  /**
   * `NEEDS_ADVANCE` 的候選超過上限(200 筆)只檢查了最久沒動的那一批:true = 還有沒檢查到的,
   * 處理完這批再查一次。`BLOCKED` 一律 false。
   */
  @Field(() => Boolean)
  truncated!: boolean;
}

@ObjectType()
export class WorkflowTaskPayload {
  @Field(() => WorkflowTaskModel)
  task!: WorkflowTaskModel;

  /** `decideTask` 的結果;其他動作一律 `accepted`。 */
  @Field(() => WorkflowDecideResultEnum)
  result!: WorkflowDecideResultEnum;
}

@ObjectType()
export class WorkflowTasksPayload {
  @Field(() => [WorkflowTaskModel])
  items!: WorkflowTaskModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

/** 批次核准一筆失敗的原因(底座規格 3.10 B18)。 */
export enum WorkflowBatchApproveFailureEnum {
  /** 任務已被處理、改派,或此關已結束(「這件已不在你手上」)。 */
  NOT_YOURS = "notYours",
  /** 被專案的 `beforeApprove` 守門擋下(錯誤碼在 `projectReason`)。 */
  BLOCKED = "blocked",
  /** 其他失敗(這一筆的交易回復,其他筆不受影響)。 */
  FAILED = "failed",
}

registerEnumType(WorkflowBatchApproveFailureEnum, {
  name: "WorkflowBatchApproveFailure",
  description: "批次核准一筆失敗的原因:已不在你手上 / 被守門擋下 / 其他失敗",
});

/** 批次核准的一筆結果;順序同輸入(去重後)。 */
@ObjectType()
export class WorkflowBatchApproveResultModel {
  @Field(() => ID)
  taskId!: string;

  @Field(() => Boolean)
  ok!: boolean;

  /** 失敗原因;成功時 `null`。 */
  @Field(() => WorkflowBatchApproveFailureEnum, { nullable: true })
  reason!: WorkflowBatchApproveFailureEnum | null;

  /** `reason: BLOCKED` 時的專案錯誤碼(前端文案 `admin.lifecycle.<碼>`);其他情況 `null`。 */
  @Field(() => String, { nullable: true })
  projectReason!: string | null;
}

@ObjectType()
export class BatchApproveTasksPayload {
  @Field(() => [WorkflowBatchApproveResultModel])
  results!: WorkflowBatchApproveResultModel[];
}
