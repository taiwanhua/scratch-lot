import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  ACCOUNTS_KEY,
  CASH_MOVEMENT_TYPES,
  CASH_PLACES,
  type CashMovementType,
  type CashPlace,
  WITHDRAW_REASONS,
  type WithdrawReason,
} from "@repo/domain/project/lottery-accounts";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_CASH_MOVEMENTS_COLLECTION = "lottery_cash_movements";

/**
 * 現金流水(專案規格 10.2;正本 `docs/modules/project/accounts.md`「資料」)。**只新增**;
 * 寫入的唯一入口是 `project/lottery/cash/cash-ledger.service.ts`。小金庫與抽屜的應有金額
 * 只由流水加總(第 17 章共通原則),沒有可被改寫的餘額欄位。
 * 登記人 / 時間 = 基礎欄位 `createdBy` / `createdAt`;`occurredAt` = 發生時間。
 */
@Schema({ collection: LOTTERY_CASH_MOVEMENTS_COLLECTION, timestamps: true })
export class LotteryCashMovement {
  /** 這筆現金屬於哪一家分店(小金庫、抽屜都在分店)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 發生時間。 */
  @Prop({ type: Date, required: true })
  occurredAt!: Date;

  @Prop({ type: String, required: true, enum: CASH_MOVEMENT_TYPES })
  type!: CashMovementType;

  /** 從 / 到(抽屜 / 小金庫 / 銀行 / 外部;沖正的那一筆兩端對調)。 */
  @Prop({ type: String, required: true, enum: CASH_PLACES })
  from!: CashPlace;

  @Prop({ type: String, required: true, enum: CASH_PLACES })
  to!: CashPlace;

  /** 出庫的原因(開班零用金 / 補零錢 / 其他);其他類型為 null。 */
  @Prop({ type: String, enum: [...WITHDRAW_REASONS, null], default: null })
  reason!: WithdrawReason | null;

  /** 抽屜所屬的收銀點(兩端都不是抽屜 = null)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  cashPointId!: Types.ObjectId | null;

  /** 發生班次(抽屜的流水)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  shiftId!: Types.ObjectId | null;

  /** 歸屬班次(只有現金更正)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  attributedShiftId!: Types.ObjectId | null;

  /** 金額(正整數)。 */
  @Prop({ type: Number, required: true })
  amount!: number;

  /** 指回的單據(模組 key、提交 id、修訂號)。 */
  @Prop({ type: String, default: null })
  refType!: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  refId!: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  refRevision!: number | null;

  /** 收付機制記在哪一邊;不是收付 = null。 */
  @Prop({ type: String, default: null })
  settlementSide!: string | null;

  /** 經手人 / 收款人(收付用現金時必填)。 */
  @Prop({ type: String, default: null })
  payee!: string | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  /** 沖正的那一筆指向原流水(一筆只能被沖正一次:唯一索引)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  reversalOf!: Types.ObjectId | null;

  /** 存銀行連到的銀行「存入」;那筆被沖正時這筆自動反向。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  bankTransactionId!: Types.ObjectId | null;

  /** 模組 key(plugin 宣告;本表固定 `accounts`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryCashMovementSchema =
  SchemaFactory.createForClass(LotteryCashMovement);

LotteryCashMovementSchema.index({ orgId: 1, createdAt: 1 });
LotteryCashMovementSchema.index({ orgId: 1, occurredAt: 1 });
LotteryCashMovementSchema.index({ shiftId: 1 });
LotteryCashMovementSchema.index({ tenantId: 1, refType: 1, refId: 1 });
LotteryCashMovementSchema.index({ bankTransactionId: 1 });
LotteryCashMovementSchema.index(
  { reversalOf: 1 },
  {
    unique: true,
    partialFilterExpression: { reversalOf: { $type: "objectId" } },
  },
);
LotteryCashMovementSchema.plugin(baseFieldsPlugin);
LotteryCashMovementSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryCashMovementSchema.path("moduleKey").default(ACCOUNTS_KEY);
