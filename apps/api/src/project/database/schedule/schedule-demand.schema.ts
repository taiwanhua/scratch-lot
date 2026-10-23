import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  SCHEDULE_DEMAND_SOURCES,
  SCHEDULE_TASK_ROLES,
} from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import type { ScheduleTemplateTask } from "./schedule-demand-template.schema";
import { SCHEDULE_MANAGE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_DEMANDS_COLLECTION = "schedule_demands";

const DemandTaskSchema = new MongooseSchema<ScheduleTemplateTask>(
  {
    taskId: { type: String, required: true },
    role: { type: String, enum: [...SCHEDULE_TASK_ROLES], required: true },
    taskKey: { type: String, required: true },
  },
  { _id: false },
);

/**
 * 人力需求(規格 14.1 `schedule_demands`、14.4):某店某崗位某時間的**一組執行任務**。
 *
 * - 需要幾人 = 執行任務筆數(沒有人數欄位);負責人 0–1 筆、協同 0–10 筆;`taskId` 在這筆內唯一
 * - 沒有休息(休息只在排班);一天不同時段人力不同時建多筆
 * - `templateId`:從哪個範本來(未套用範本的為 null,班表上顯示「臨」)
 */
@Schema({ collection: SCHEDULE_DEMANDS_COLLECTION, timestamps: true })
export class ScheduleDemand {
  /** 分店(歸屬組織)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 日期:開始時點在租戶時區那一天的 00:00(時點;跨午夜的算開始那天)。 */
  @Prop({ type: Date, required: true })
  date!: Date;

  /** 開始時點。 */
  @Prop({ type: Date, required: true })
  startAt!: Date;

  /** 結束時點(晚於開始)。 */
  @Prop({ type: Date, required: true })
  endAt!: Date;

  /** 崗位(欄位管理「崗位」的選項 value)。 */
  @Prop({ type: String, required: true })
  positionKey!: string;

  /** 執行任務(套用範本時複製一份、產生新的 taskId)。 */
  @Prop({ type: [DemandTaskSchema], default: [] })
  tasks!: ScheduleTemplateTask[];

  /** 來源範本(人力需求範本 id);未套用範本的為 null。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  templateId!: Types.ObjectId | null;

  /** 來源:範本 / 週範本 / 手動 / 自動排班補上。 */
  @Prop({ type: String, enum: [...SCHEDULE_DEMAND_SOURCES], required: true })
  source!: string;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleDemandSchema =
  SchemaFactory.createForClass(ScheduleDemand);

ScheduleDemandSchema.index({ orgId: 1, date: 1 });
ScheduleDemandSchema.plugin(baseFieldsPlugin);
// 屬於分店、不共用(排班表選的那家店要在可見範圍內)
ScheduleDemandSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleDemandSchema.path("moduleKey").default(SCHEDULE_MANAGE_MODULE_KEY);
