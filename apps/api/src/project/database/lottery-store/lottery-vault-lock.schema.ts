import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { STORE_KEY } from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_VAULT_LOCKS_COLLECTION = "lottery_vault_locks";

/**
 * 小金庫的守門文件(一家分店一筆):從小金庫拿錢的動作(出庫、開班從小金庫領零用金)在交易一開始對它
 * `$inc version`,同一家店同時兩筆在這筆文件上互相衝突、由 `TransactionService` 重跑,重跑時讀得到對方
 * 剛寫的流水 ——「出庫不能超過小金庫應有」才不會被同時送出繞過(比照抽屜的 `lottery_shifts.drawerVersion`)。
 */
@Schema({ collection: LOTTERY_VAULT_LOCKS_COLLECTION, timestamps: true })
export class LotteryVaultLock {
  /** 分店(小金庫在分店)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 每次從小金庫拿錢加 1(只用來製造寫入衝突)。 */
  @Prop({ type: Number, default: 0 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `store`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryVaultLockSchema =
  SchemaFactory.createForClass(LotteryVaultLock);

LotteryVaultLockSchema.index({ orgId: 1 }, { unique: true });
LotteryVaultLockSchema.plugin(baseFieldsPlugin);
LotteryVaultLockSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryVaultLockSchema.path("moduleKey").default(STORE_KEY);
