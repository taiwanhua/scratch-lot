import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { STORE_KEY } from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_SHIFT_PERSON_LOCKS_COLLECTION =
  "lottery_shift_person_locks";

/**
 * 開班的「人」守門文件(一個租戶裡一人一筆):開班在交易一開始對它 `$inc version`,
 * 同一個人在**兩家店**同時開班的兩個交易在這筆文件上互相衝突、由 `TransactionService` 重跑,
 * 重跑的一方讀得到對方剛開的班 ——「一個人只能同時開同一家店的班」才不會被同時送出繞過
 * (先例:排班的 `schedule_entry_locks`;刮刮樂不寫排班的表,另建一份)。
 *
 * 歸屬欄 `orgId` = 租戶頂層(人不屬於某一家店),人記在 `userId`。
 */
@Schema({ collection: LOTTERY_SHIFT_PERSON_LOCKS_COLLECTION, timestamps: true })
export class LotteryShiftPersonLock {
  /** 租戶頂層(ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 開班的人(`users._id`)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 每次這個人開班加 1(只用來製造寫入衝突)。 */
  @Prop({ type: Number, default: 0 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `store`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryShiftPersonLockSchema = SchemaFactory.createForClass(
  LotteryShiftPersonLock,
);

LotteryShiftPersonLockSchema.index({ orgId: 1, userId: 1 }, { unique: true });
LotteryShiftPersonLockSchema.plugin(baseFieldsPlugin);
LotteryShiftPersonLockSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryShiftPersonLockSchema.path("moduleKey").default(STORE_KEY);
