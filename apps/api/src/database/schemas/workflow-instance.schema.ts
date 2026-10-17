import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import type { SubmissionSummary } from "@repo/domain/form";
import {
  ASSIGNEE_STATES,
  type AssigneeState,
  DECISIONS,
  type Decision,
  HISTORY_KINDS,
  HISTORY_REASONS,
  type HistoryKind,
  type HistoryReason,
  INSTANCE_STATUSES,
  type InstanceStatus,
  type NotifiedResult,
  STEP_STATUSES,
  type StepStatus,
  type TerminalDecision,
} from "@repo/domain/workflow";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import { tenantScopePlugin } from "../plugins/tenant-scope.plugin";

/** collection 名。 */
export const WORKFLOW_INSTANCES_COLLECTION = "workflow_instances";

/** 派任計畫的一項(`taskKey = "<stepKey>-<seq>"`,改派不變)。 */
@Schema({ _id: false })
export class WorkflowPlanItem {
  @Prop({ type: String, required: true })
  taskKey!: string;

  @Prop({ type: Types.ObjectId, required: true })
  assigneeId!: Types.ObjectId;

  /** 被改派走的人(讀取授權用)。 */
  @Prop({ type: [Types.ObjectId], default: [] })
  previousAssigneeIds!: Types.ObjectId[];

  /** `invalid` = 承辦人停用 / 移出租戶(阻擋的依據)。 */
  @Prop({ type: String, required: true, enum: ASSIGNEE_STATES })
  assigneeState!: AssigneeState;
}

const WorkflowPlanItemSchema = SchemaFactory.createForClass(WorkflowPlanItem);

/** 已接受的決定;陣列順序 = 接受順序,每個 `taskKey` 最多一筆(由 `decideTask` 原子 `$push`)。 */
@Schema({ _id: false })
export class WorkflowDecision {
  @Prop({ type: String, required: true })
  taskKey!: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: DECISIONS })
  decision!: Decision;

  /** 駁回 / 退回必填。 */
  @Prop({ type: String, default: null })
  comment!: string | null;

  @Prop({ type: Date, required: true })
  at!: Date;
}

const WorkflowDecisionSchema = SchemaFactory.createForClass(WorkflowDecision);

/** `steps[]` 的一筆(以 `stepKey` 對應版本的節點;實例內唯一、不可變)。 */
@Schema({ _id: false })
export class WorkflowStepState {
  @Prop({ type: String, required: true })
  stepKey!: string;

  @Prop({ type: String, required: true, enum: STEP_STATUSES })
  status!: StepStatus;

  @Prop({ type: Boolean, default: false })
  blocked!: boolean;

  @Prop({ type: [WorkflowPlanItemSchema], default: [] })
  plan!: WorkflowPlanItem[];

  @Prop({ type: [WorkflowDecisionSchema], default: [] })
  decisions!: WorkflowDecision[];
}

const WorkflowStepStateSchema = SchemaFactory.createForClass(WorkflowStepState);

/** 歷程事件(事件流水;`notified` 帶 `result` 當通知的冪等標記)。 */
@Schema({ _id: false })
export class WorkflowHistoryEvent {
  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, required: true, enum: HISTORY_KINDS })
  kind!: HistoryKind;

  @Prop({ type: String, default: null })
  stepKey!: string | null;

  @Prop({ type: String, default: null })
  taskKey!: string | null;

  @Prop({ type: Types.ObjectId, default: null })
  userId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  toUserId!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  comment!: string | null;

  @Prop({ type: String, default: null })
  result!: NotifiedResult | null;

  /** 跳過 / 自動通過的原因(`step_skipped`:哪一項成立;`approved`:B5 自動通過);其他 null。 */
  @Prop({ type: String, enum: [...HISTORY_REASONS, null], default: null })
  reason!: HistoryReason | null;

  /** 只有 `auto_approve_blocked`:守門擋下的專案錯誤碼。 */
  @Prop({ type: String, default: null })
  code!: string | null;
}

const WorkflowHistoryEventSchema =
  SchemaFactory.createForClass(WorkflowHistoryEvent);

/** 全案終局採用的那一筆決定(只能從 null 寫成有值一次)。 */
export interface WorkflowOutcome {
  kind: TerminalDecision;
  stepKey: string;
  taskKey: string;
  historyIndex: number;
}

/**
 * 流程實例(Spec 6b §4「workflow_instances」;`docs/data-model.md`):一筆提交的某個修訂號送出後的一次執行。
 * **唯一權威**:關卡進度、派任計畫、已接受的決定都在這份文件上,任務文件只是投影。
 *
 * 模組資料表(`tenantScopePlugin({ moduleData: true })`):`moduleKey` / `tenantId` / `orgId` /
 * `createdBy` 都抄自提交;`orgId` 是主管解析的起點。資料範圍規則對這張表**不套**(seed 不宣告它的
 * 資料範圍目標,規則無從命中);審核者的讀取走 `canReadSubmissionRevision`,不靠可見範圍。
 */
@Schema({
  collection: WORKFLOW_INSTANCES_COLLECTION,
  timestamps: true,
  minimize: false,
})
export class WorkflowInstance {
  @Prop({ type: Types.ObjectId, required: true })
  submissionId!: Types.ObjectId;

  /** 審的是哪個修訂號的快照(6a `revisions[]`)。 */
  @Prop({ type: Number, required: true })
  revision!: number;

  /** 抄自提交(資料歸屬組織 = 主管解析的起點)。 */
  @Prop({ type: Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  formKey!: string;

  @Prop({ type: Number, required: true })
  formVersion!: number;

  /** 該修訂的摘要槽快照;任務列表 / 通知 / 詳情摘要讀它,不讀提交最新的 `summary`。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  summary!: SubmissionSummary | null;

  @Prop({ type: String, required: true })
  workflowKey!: string;

  @Prop({ type: Number, required: true })
  workflowVersion!: number;

  @Prop({ type: String, required: true, enum: INSTANCE_STATUSES })
  status!: InstanceStatus;

  /** 目前進行中的關卡 key;直線時長度 ≤ 1,分流後多個,結束後為空。 */
  @Prop({ type: [String], default: [] })
  activeStepKeys!: string[];

  @Prop({ type: [WorkflowStepStateSchema], default: [] })
  steps!: WorkflowStepState[];

  /** 任何一次狀態改變 +1(CAS 型動作帶預期值;決定不比對、但成功時原子 +1)。 */
  @Prop({ type: Number, default: 0 })
  editVersion!: number;

  @Prop({ type: [WorkflowHistoryEventSchema], default: [] })
  history!: WorkflowHistoryEvent[];

  @Prop({ type: Date, default: null })
  finishedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  outcome!: WorkflowOutcome | null;

  /** 模組 key(`tenantScopePlugin` 的 `moduleData` 宣告;抄自提交)。 */
  moduleKey!: string;

  /** 租戶頂層 id(同上;`BaseRepository.create` 依 `orgId` 推導)。 */
  tenantId!: Types.ObjectId | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const WorkflowInstanceSchema =
  SchemaFactory.createForClass(WorkflowInstance);

// 同一筆提交的同一個修訂號只有一個實例 → 送出重試沿用同一個
WorkflowInstanceSchema.index(
  { submissionId: 1, revision: 1 },
  { unique: true },
);
// 阻擋清單 / 需要推進的查詢(以租戶為邊界)
WorkflowInstanceSchema.index({ tenantId: 1, status: 1 });
// 基礎欄位(ADR-0007)+ 模組資料表的 moduleKey / tenantId(ADR-0005)
WorkflowInstanceSchema.plugin(baseFieldsPlugin);
WorkflowInstanceSchema.plugin(tenantScopePlugin, { moduleData: true });
