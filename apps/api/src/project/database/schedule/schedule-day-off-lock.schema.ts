import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MY_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_DAY_OFF_LOCKS_COLLECTION = "schedule_day_off_locks";

/**
 * 畫休寫入的守門文件(一家店一個月一筆):畫休的登記 / 代改 / 刪除在交易一開始對它 `$inc version`,
 * 同一家主要分店、同一個月同時進來的寫入在這筆文件上互相衝突,由 `TransactionService` 重跑整段
 * 「讀畫休 → 跑規則 → 寫入」—— 同日最多畫休人數、每月最多畫休、時段不重疊才不會被同時送出繞過
 * (先例:表單提交的 `editVersion`)。
 *
 * 歸屬欄 `orgId` = 租戶頂層(同畫休本身),鎖的是哪一家店記在 `storeId`:守門文件不會擋下刪除分店。
 */
@Schema({ collection: SCHEDULE_DAY_OFF_LOCKS_COLLECTION, timestamps: true })
export class ScheduleDayOffLock {
  /** 租戶頂層(ADR-0005;同畫休)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 主要分店(規則檢查的那家店)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  storeId!: Types.ObjectId;

  /** 畫休的月份 `YYYY-MM`。 */
  @Prop({ type: String, required: true })
  month!: string;

  /** 每次寫入加 1(只用來製造寫入衝突)。 */
  @Prop({ type: Number, default: 0 })
  version!: number;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleDayOffLockSchema =
  SchemaFactory.createForClass(ScheduleDayOffLock);

ScheduleDayOffLockSchema.index(
  { orgId: 1, storeId: 1, month: 1 },
  { unique: true },
);
ScheduleDayOffLockSchema.plugin(baseFieldsPlugin);
ScheduleDayOffLockSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleDayOffLockSchema.path("moduleKey").default(SCHEDULE_MY_MODULE_KEY);
