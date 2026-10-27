import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  SCHEDULE_PUNCH_SOURCES,
  SCHEDULE_PUNCH_TYPES,
} from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_ATTENDANCE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION =
  "schedule_attendance_punches";

/**
 * 打卡(規格 14.1 `schedule_attendance_punches`、14.6 打卡):**只新增**。
 *
 * - 時間 `at` 與類型 `type` 不能改;對應排班 `entryId` 可以改(出勤紀錄的 [改對應排班])
 * - `entryId = null` = 未對應排班(「沒有排班」區塊打的卡,或補打卡選「沒有排班(臨時代班)」)
 * - `duplicate`:同一班多打的卡(上班取最早、下班取最晚,其餘標「重複打卡」);
 *   每次寫入同一班同類型的卡時重算(`my/punch-rules.ts` 的 `duplicatePunchIdsOf`)
 * - `orgId`:打卡的分店 = 對應排班的分店;未對應排班 = 打卡當下的當前組織。屬於那家店、不共用
 */
@Schema({
  collection: SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION,
  timestamps: true,
})
export class ScheduleAttendancePunch {
  /** 分店(歸屬組織)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 打卡的人(`users._id`)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 打卡時點(按鈕 = 伺服器收到的時間;補打卡 = 申請的時間)。 */
  @Prop({ type: Date, required: true })
  at!: Date;

  /** `in` 上班 / `out` 下班。 */
  @Prop({ type: String, enum: [...SCHEDULE_PUNCH_TYPES], required: true })
  type!: string;

  /** 對應排班(`schedule_entries._id`);null = 未對應排班。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  entryId!: Types.ObjectId | null;

  /** 打卡時的來源 IP(補打卡為 null)。 */
  @Prop({ type: String, default: null })
  ip!: string | null;

  /** 打卡時的瀏覽器 User-Agent(補打卡為 null)。 */
  @Prop({ type: String, default: null })
  userAgent!: string | null;

  /** `button` 按鈕 / `makeup` 補打卡。 */
  @Prop({ type: String, enum: [...SCHEDULE_PUNCH_SOURCES], required: true })
  source!: string;

  /** 補打卡申請(表單提交 id);按鈕打的卡為 null。有值時唯一(部分唯一索引)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  makeupRequestId!: Types.ObjectId | null;

  /** 重複打卡(同一班同類型不是生效的那一張)。 */
  @Prop({ type: Boolean, default: false })
  duplicate!: boolean;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleAttendancePunchSchema = SchemaFactory.createForClass(
  ScheduleAttendancePunch,
);

ScheduleAttendancePunchSchema.index({ userId: 1, at: 1 });
ScheduleAttendancePunchSchema.index({ entryId: 1, type: 1 });
ScheduleAttendancePunchSchema.index({ orgId: 1, at: 1 });
// 一張補打卡申請只寫一張卡(完成的事後動作同時跑兩次時,第二次撞索引、整個動作回復)
ScheduleAttendancePunchSchema.index(
  { makeupRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      makeupRequestId: { $type: "objectId" },
      deletedAt: { $type: "null" },
    },
  },
);
ScheduleAttendancePunchSchema.plugin(baseFieldsPlugin);
ScheduleAttendancePunchSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
ScheduleAttendancePunchSchema.path("moduleKey").default(
  SCHEDULE_ATTENDANCE_MODULE_KEY,
);
