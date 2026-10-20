import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_ASSIGNMENT_SOURCES } from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MANAGE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_TASK_ASSIGNMENTS_COLLECTION = "schedule_task_assignments";

/**
 * 排班填進執行任務(規格 14.1 `schedule_task_assignments`):
 *
 * - 一筆執行任務只填一個人:唯一 `(demandId, taskId)`(`taskId` 在人力需求內唯一)
 * - 同一筆排班可以填進多筆執行任務,但**在同一筆人力需求裡只能填一筆**:唯一 `(entryId, demandId)`
 * - 自動填進的被手動改過 → `source` 改成手動;`autoRunId` / `reason` 只留著追查(自動排班寫)
 * - 解除 = 軟刪除(唯一索引只算未刪除的)
 */
@Schema({ collection: SCHEDULE_TASK_ASSIGNMENTS_COLLECTION, timestamps: true })
export class ScheduleTaskAssignment {
  /** 分店(同排班與人力需求)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  entryId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  demandId!: Types.ObjectId;

  /** 人力需求裡那一筆執行任務的 `taskId`。 */
  @Prop({ type: String, required: true })
  taskId!: string;

  /** `manual` 手動 / `auto` 自動。 */
  @Prop({
    type: String,
    enum: [...SCHEDULE_ASSIGNMENT_SOURCES],
    default: "manual",
  })
  source!: string;

  /** 自動排班執行紀錄 id(只留著追查)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  autoRunId!: Types.ObjectId | null;

  /** 自動填進的理由。 */
  @Prop({ type: String, default: null })
  reason!: string | null;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleTaskAssignmentSchema = SchemaFactory.createForClass(
  ScheduleTaskAssignment,
);

const NOT_DELETED = { deletedAt: { $type: "null" } };

ScheduleTaskAssignmentSchema.index(
  { demandId: 1, taskId: 1 },
  {
    unique: true,
    partialFilterExpression: NOT_DELETED,
    name: "unique_assignment_per_task",
  },
);
ScheduleTaskAssignmentSchema.index(
  { entryId: 1, demandId: 1 },
  {
    unique: true,
    partialFilterExpression: NOT_DELETED,
    name: "unique_assignment_per_entry_demand",
  },
);
ScheduleTaskAssignmentSchema.index({ orgId: 1, createdAt: 1 });
ScheduleTaskAssignmentSchema.plugin(baseFieldsPlugin);
ScheduleTaskAssignmentSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleTaskAssignmentSchema.path("moduleKey").default(
  SCHEDULE_MANAGE_MODULE_KEY,
);
