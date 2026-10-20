import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_EMPLOYMENT_TYPES } from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_SETTINGS_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_STAFF_COLLECTION = "schedule_staff";

/**
 * 排班檔案(規格 14.1、14.3):使用者的子檔,一個租戶裡一人一筆;不是新建人,
 * 是從使用者管理已有的帳號 [加入排班] 建立。可以排哪些分店在 `schedule_relationships`。
 *
 * - `orgId`:租戶頂層(最上層組織);排班檔案是整個租戶共用的(先例:遊戲 `lottery_games`),讀取以 `tenantId` 為界
 * - 唯一 `(tenantId, userId)`
 */
@Schema({ collection: SCHEDULE_STAFF_COLLECTION, timestamps: true })
export class ScheduleStaff {
  /** 租戶頂層(ADR-0005;整個租戶共用的檔案)。 */
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

ScheduleStaffSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
ScheduleStaffSchema.index({ orgId: 1, createdAt: 1 });
ScheduleStaffSchema.plugin(baseFieldsPlugin);
ScheduleStaffSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleStaffSchema.path("moduleKey").default(SCHEDULE_SETTINGS_MODULE_KEY);
