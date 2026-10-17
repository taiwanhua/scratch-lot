import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import { TASK_STATUSES, type TaskStatus } from "@repo/domain/workflow";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/** collection 名;存取只經 `WorkflowTasksRepository`(每個方法強制帶 `tenantId`)。 */
export const WORKFLOW_TASKS_COLLECTION = "workflow_tasks";

/**
 * 審核任務(Spec 6b §4「workflow_tasks」;`docs/data-model.md`):實例派任計畫一項的**投影**。
 * 狀態、承辦人都由 `advance` 依實例同步;「待我審核」列表與讀取授權直接用它。
 *
 * **不掛 `tenantScopePlugin`**:任務沒有 `orgId`,而審核者不一定在申請人組織的可見範圍內
 * (指定使用者、角色、上層主管),掛了就查不到自己的待辦。邊界改成 `tenantId`(同
 * `business_relationships`):`WorkflowTasksRepository` 每個讀寫方法都強制帶 `tenantId`。
 */
@Schema({ collection: WORKFLOW_TASKS_COLLECTION, timestamps: true })
export class WorkflowTask {
  @Prop({ type: Types.ObjectId, required: true })
  instanceId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  stepKey!: string;

  /** `(instanceId, taskKey)` 唯一 → 依計畫建任務重跑不會重建;改派不動。 */
  @Prop({ type: String, required: true })
  taskKey!: string;

  /** 以下五欄抄自實例。 */
  @Prop({ type: Types.ObjectId, required: true })
  submissionId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  revision!: number;

  @Prop({ type: String, required: true })
  moduleKey!: string;

  @Prop({ type: String, required: true })
  formKey!: string;

  /** 租戶邊界(租戶頂層 `orgs` id)。 */
  @Prop({ type: Types.ObjectId, required: true })
  tenantId!: Types.ObjectId;

  /** 與實例 `plan` 該項同步。 */
  @Prop({ type: Types.ObjectId, required: true })
  assigneeId!: Types.ObjectId;

  /** 被改派走的人(讀取授權:曾持有者仍可讀該修訂)。 */
  @Prop({ type: [Types.ObjectId], default: [] })
  previousAssigneeIds!: Types.ObjectId[];

  @Prop({ type: String, required: true, enum: TASK_STATUSES })
  status!: TaskStatus;

  /** 抄自實例的決定。 */
  @Prop({ type: Date, default: null })
  decidedAt!: Date | null;

  @Prop({ type: String, default: null })
  comment!: string | null;

  /** 只擋同一個人兩個分頁重複送;關卡結果由實例決定。 */
  @Prop({ type: Number, default: 0 })
  editVersion!: number;

  /**
   * 派給目前承辦人的時點(建任務、改派時寫;B16 逾時提醒從這裡起算)。這個欄位出現之前的任務為 null。
   */
  @Prop({ type: Date, default: null })
  assignedAt!: Date | null;

  /** B16 這一次指派已通知到第幾級(0 = 還沒、1 = 已通知審核者、2 = 已通知通知對象);改派歸 0。 */
  @Prop({ type: Number, default: 0 })
  overdueLevel!: number;

  /**
   * B16 下一級該通知的時點(`assignedAt` + N / M 小時);關卡沒開逾時提醒、已通知完兩級 = null。
   * 排程只撈 `status = pending` 且這個時點已到的任務。
   */
  @Prop({ type: Date, default: null })
  overdueDueAt!: Date | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const WorkflowTaskSchema = SchemaFactory.createForClass(WorkflowTask);

WorkflowTaskSchema.index({ instanceId: 1, taskKey: 1 }, { unique: true });
// 待我審核(依承辦人與狀態)
WorkflowTaskSchema.index({ assigneeId: 1, status: 1 });
// 以租戶為邊界的模組 / 狀態篩選
WorkflowTaskSchema.index({ tenantId: 1, moduleKey: 1, status: 1 });
// 曾持有(被改派走)的人仍可讀該修訂
WorkflowTaskSchema.index({ previousAssigneeIds: 1 });
// B16 逾時提醒的排程(以租戶為邊界,只撈待處理且到期的)
WorkflowTaskSchema.index({ tenantId: 1, status: 1, overdueDueAt: 1 });
// 基礎欄位(ADR-0007);不掛 tenantScope(理由見 class 註解)
WorkflowTaskSchema.plugin(baseFieldsPlugin);
