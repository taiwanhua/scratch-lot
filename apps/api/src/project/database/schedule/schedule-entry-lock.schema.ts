import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MANAGE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_ENTRY_LOCKS_COLLECTION = "schedule_entry_locks";

/**
 * 排班寫入的「人」守門文件(一個租戶裡一人一筆):新增 / 修改排班在交易一開始對它 `$inc version`,
 * 同一個人在**不同分店**同時被排的寫入也在這筆文件上互相衝突、由 `TransactionService` 重跑整段
 * 「讀這個人所有分店的排班 → 檢查重疊 → 寫入」—— 跨店不能重疊才不會被同時送出繞過
 * (先例:畫休的守門文件 `schedule_day_off_locks`)。
 *
 * 歸屬欄 `orgId` = 租戶頂層(人不屬於某一家店;不擋刪除分店),人記在 `userId`。
 * 不放在 `schedule_staff` 上:那是使用者看得到、會被編輯的檔案,`$inc` 會連帶改它的 `updatedAt / updatedBy`。
 */
@Schema({ collection: SCHEDULE_ENTRY_LOCKS_COLLECTION, timestamps: true })
export class ScheduleEntryLock {
  /** 租戶頂層(ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 排班的人(`users._id`)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 每次寫入這個人的排班加 1(只用來製造寫入衝突)。 */
  @Prop({ type: Number, default: 0 })
  version!: number;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleEntryLockSchema =
  SchemaFactory.createForClass(ScheduleEntryLock);

ScheduleEntryLockSchema.index({ orgId: 1, userId: 1 }, { unique: true });
ScheduleEntryLockSchema.plugin(baseFieldsPlugin);
ScheduleEntryLockSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleEntryLockSchema.path("moduleKey").default(SCHEDULE_MANAGE_MODULE_KEY);
