import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { DEALERS_MODULE_KEY } from "./lottery-dealer.schema";

export const LOTTERY_WHOLESALE_CUSTOMER_LOCKS_COLLECTION =
  "lottery_wholesale_customer_locks";

/**
 * 批售客戶的守門文件(一位客戶一筆,歸屬組織同客戶;比照 `lottery_vault_locks`):「送出批售單」與「刪除客戶」在交易裡
 * 都對它 `$inc version`,兩個交易互相衝突、由 `TransactionService` 重跑,重跑的一方看得到對方(刪除看得到引用、
 * 送出看到客戶已刪除)。不寫在客戶上:送出單據不算修改客戶(修改者、修改時間不動)。
 */
@Schema({
  collection: LOTTERY_WHOLESALE_CUSTOMER_LOCKS_COLLECTION,
  timestamps: true,
})
export class LotteryWholesaleCustomerLock {
  /** 歸屬組織(同客戶)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 批售客戶。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  customerId!: Types.ObjectId;

  /** 每次送出 / 刪除加 1(只用來製造寫入衝突)。 */
  @Prop({ type: Number, default: 0 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `dealers`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryWholesaleCustomerLockSchema = SchemaFactory.createForClass(
  LotteryWholesaleCustomerLock,
);

LotteryWholesaleCustomerLockSchema.index({ customerId: 1 }, { unique: true });
LotteryWholesaleCustomerLockSchema.plugin(baseFieldsPlugin);
LotteryWholesaleCustomerLockSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryWholesaleCustomerLockSchema.path("moduleKey").default(
  DEALERS_MODULE_KEY,
);
