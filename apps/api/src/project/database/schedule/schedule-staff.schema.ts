import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_EMPLOYMENT_TYPES } from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_SETTINGS_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_STAFF_COLLECTION = "schedule_staff";

/**
 * 排班檔案(規格 14.1、14.3):使用者的子檔,一個租戶裡一人一份;不是新建人,
 * 是從使用者管理已有的帳號 [加入排班] 建立。可以排哪些分店在 `schedule_relationships`。
 *
 * - `orgId`:建立它的組織(當前組織);讀取與修改照一般可見性
 *   (跨店支援由支援需求單把人加進那家店)
 * - 唯一 `(tenantId, userId)`:一個租戶一人一份
 */
@Schema({ collection: SCHEDULE_STAFF_COLLECTION, timestamps: true })
export class ScheduleStaff {
  /** 建立它的組織(ADR-0005;不共用,照一般可見性讀)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 使用者 `users._id`。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 僱用類型:正職 `full-time` / 兼職 `part-time`(程式固定)。 */
  @Prop({
    type: String,
    enum: [...SCHEDULE_EMPLOYMENT_TYPES],
    default: "full-time",
  })
  employmentType!: string;

  /** 停用 = 不再是候選人(資料保留)。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 備註(選填)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(固定 `schedule.settings`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(`BaseRepository.create` 推導)。 */
  tenantId!: Types.ObjectId | null;
}

export const ScheduleStaffSchema = SchemaFactory.createForClass(ScheduleStaff);

// 一個租戶一人一份(規格 14.1:使用者子檔,一對一;沒有軟刪除)
ScheduleStaffSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
ScheduleStaffSchema.index({ orgId: 1, createdAt: 1 });
ScheduleStaffSchema.plugin(baseFieldsPlugin);
ScheduleStaffSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleStaffSchema.path("moduleKey").default(SCHEDULE_SETTINGS_MODULE_KEY);
