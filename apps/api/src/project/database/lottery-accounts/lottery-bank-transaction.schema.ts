import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  ACCOUNTS_KEY,
  BANK_TRANSACTION_TYPES,
  type BankTransactionType,
  DIRECTIONS,
  type Direction,
} from "@repo/domain/project/lottery-accounts";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_BANK_TRANSACTIONS_COLLECTION = "lottery_bank_transactions";

/**
 * 銀行交易(專案規格 10.1;正本 `docs/modules/project/accounts.md`「資料」)。**只新增**:
 * 沒有修改、刪除;記錯用沖正(寫一筆方向相反、同金額的交易,`reversalOf` 指向原交易,原交易不改)。
 * 登記人 / 時間 = 基礎欄位 `createdBy` / `createdAt`。
 *
 * 讀取:看得到帳戶就看得到它的交易(帳戶可能是共用進來的,交易照帳戶反查,登記在租戶邊界上下文)。
 */
@Schema({ collection: LOTTERY_BANK_TRANSACTIONS_COLLECTION, timestamps: true })
export class LotteryBankTransaction {
  /** 登記時的當前組織(租戶隔離,ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 帳戶(`lottery_bank_accounts`)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  accountId!: Types.ObjectId;

  /** 發生時間(時點)。 */
  @Prop({ type: Date, required: true })
  occurredAt!: Date;

  /** 類型(沖正的那一筆沿用原交易的類型)。 */
  @Prop({ type: String, required: true, enum: BANK_TRANSACTION_TYPES })
  type!: BankTransactionType;

  /** 方向:收 / 支(固定類型由 api 依類型填;調整、其他由使用者選;沖正 = 原交易的相反)。 */
  @Prop({ type: String, required: true, enum: DIRECTIONS })
  direction!: Direction;

  /** 金額(正整數;單據送出時的自動記帳可以是 0,例 進貨單應付 0)。 */
  @Prop({ type: Number, required: true })
  amount!: number;

  /** 歸屬分店(進貨與調貨必填)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  branchOrgId!: Types.ObjectId | null;

  /** 指回的單據:模組 key(例 `purchasing.purchase`)、提交 id、修訂號。 */
  @Prop({ type: String, default: null })
  refType!: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  refId!: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  refRevision!: number | null;

  /** 收付機制記在哪一邊(單據登記的 `side`;例 `hq` / `receiver` / `shipper`);不是收付 = null。 */
  @Prop({ type: String, default: null })
  settlementSide!: string | null;

  /** 沖正的那一筆指向原交易(一筆交易只能被沖正一次:唯一索引)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  reversalOf!: Types.ObjectId | null;

  /** 摘要 / 說明(調整、其他必填;200 字內)。 */
  @Prop({ type: String, default: null })
  summary!: string | null;

  /** 經手人 / 收款人(收付機制的付款視窗;選填)。 */
  @Prop({ type: String, default: null })
  handler!: string | null;

  /** 備註(沖正原因也寫在這裡)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `accounts`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryBankTransactionSchema = SchemaFactory.createForClass(
  LotteryBankTransaction,
);

LotteryBankTransactionSchema.index({ orgId: 1, createdAt: 1 });
LotteryBankTransactionSchema.index({ accountId: 1, occurredAt: 1 });
LotteryBankTransactionSchema.index({ tenantId: 1, refType: 1, refId: 1 });
// 一筆交易只能被沖正一次(兩個人同時按 [沖正] 只有一個成功)
LotteryBankTransactionSchema.index(
  { reversalOf: 1 },
  {
    unique: true,
    partialFilterExpression: { reversalOf: { $type: "objectId" } },
  },
);
LotteryBankTransactionSchema.plugin(baseFieldsPlugin);
LotteryBankTransactionSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryBankTransactionSchema.path("moduleKey").default(ACCOUNTS_KEY);
