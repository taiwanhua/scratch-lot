import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MANAGE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_ENTRIES_COLLECTION = "schedule_entries";

/**
 * 排班(規格 14.1 `schedule_entries`):人、店、上下班時間、休息。
 *
 * - 一個人同一時間只有一筆排班,**跨店也不能重疊**(service 以租戶為邊界檢查)
 * - **至少要填進一筆執行任務才能存**(`schedule_task_assignments`)
 * - 休息只在排班:新增時依規則「預設休息」帶入,排班對話框可以改
 * - 已被收銀班次綁定的不能刪除(`integration/entry-deletion-guards.ts`)
 */
@Schema({ collection: SCHEDULE_ENTRIES_COLLECTION, timestamps: true })
export class ScheduleEntry {
  /** 分店(歸屬組織)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 排班的人(`users._id`)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 日期:上班時點在租戶時區那一天的 00:00(時點;跨午夜的算開始那天)。 */
  @Prop({ type: Date, required: true })
  date!: Date;

  /** 上班時點。 */
  @Prop({ type: Date, required: true })
  startAt!: Date;

  /** 下班時點(晚於上班)。 */
  @Prop({ type: Date, required: true })
  endAt!: Date;

  /** 休息分鐘數。 */
  @Prop({ type: Number, default: 0 })
  breakMinutes!: number;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleEntrySchema = SchemaFactory.createForClass(ScheduleEntry);

ScheduleEntrySchema.index({ userId: 1, startAt: 1 });
ScheduleEntrySchema.index({ orgId: 1, date: 1 });
ScheduleEntrySchema.plugin(baseFieldsPlugin);
ScheduleEntrySchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleEntrySchema.path("moduleKey").default(SCHEDULE_MANAGE_MODULE_KEY);
