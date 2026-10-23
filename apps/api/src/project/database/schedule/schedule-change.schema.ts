import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MANAGE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_CHANGES_COLLECTION = "schedule_changes";

/** 發布後的異動動作(`<對象>.<動作>`)。 */
export const SCHEDULE_CHANGE_ACTIONS = [
  "entry.create",
  "entry.edit",
  "entry.delete",
  "demand.create",
  "demand.edit",
  "demand.delete",
] as const;

/**
 * 發布後的排班異動(規格 14.1 `schedule_changes`、14.5「已發布後,兩種對話框都多一個異動原因」):
 * 只有**已發布**月份的人力需求 / 排班被新增、修改、刪除時才寫,一筆異動一列;
 * 「移除這天所有排班」每刪一筆排班一列(原因只填一次,各列同一個原因)。
 * 我的班表的「最近異動」讀這張表(`userIds` = 異動牽涉的人)。只新增,不改不刪。
 */
@Schema({ collection: SCHEDULE_CHANGES_COLLECTION, timestamps: true })
export class ScheduleChange {
  /** 分店(異動的排班 / 人力需求所在的店)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 月份 `YYYY-MM`(已發布的那個月)。 */
  @Prop({ type: String, required: true })
  month!: string;

  /** 異動那天(租戶時區 00:00 的時點;排班 / 人力需求的日期,改到別天時是改之後的那天)。 */
  @Prop({ type: Date, required: true })
  date!: Date;

  /** 見 `SCHEDULE_CHANGE_ACTIONS`。 */
  @Prop({ type: String, enum: [...SCHEDULE_CHANGE_ACTIONS], required: true })
  action!: string;

  /** 異動的排班 / 人力需求 id。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  /** 異動牽涉的人(排班的人;人力需求是改之前、之後填它的人,與因此解除 / 刪除排班的人)。 */
  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] })
  userIds!: Types.ObjectId[];

  /** 改之前(新增時 null)。形狀同稽核的 before。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  before!: Record<string, unknown> | null;

  /** 改之後(刪除時 null)。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  after!: Record<string, unknown> | null;

  /** 排班異動原因(欄位管理「排班異動原因」的選項 value)。 */
  @Prop({ type: String, required: true })
  reasonKey!: string;

  /** 原因說明(選「其他」必填)。 */
  @Prop({ type: String, default: null })
  reasonNote!: string | null;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleChangeSchema =
  SchemaFactory.createForClass(ScheduleChange);

ScheduleChangeSchema.index({ orgId: 1, date: 1 });
ScheduleChangeSchema.index({ userIds: 1, createdAt: -1 });
ScheduleChangeSchema.plugin(baseFieldsPlugin);
ScheduleChangeSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleChangeSchema.path("moduleKey").default(SCHEDULE_MANAGE_MODULE_KEY);
