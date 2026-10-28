import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { ACCOUNTS_KEY } from "@repo/domain/project/lottery-accounts";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_SETTLEMENT_MARKS_COLLECTION = "lottery_settlement_marks";

/**
 * 已完成單據的結清標記(收付機制的讀取索引;正本 `docs/modules/project/accounts.md`「待結清款項」):
 * 待結清只掃「還沒結清的」—— 還沒完成的單據(審核中 / 退回 / 撤回)筆數有限,照狀態查;已完成的單據會一直累積,
 * 改由這張表挑出還要算的那些。
 *
 * - 單據完成時建一筆(`closedAsOf = null`,待確認);之後這張單每寫一筆收付(含沖正)→ 改回 null、`rev + 1`
 * - 讀待結清時算出已結清(或已不是有效單據)的,寫上 `closedAsOf`(算的當下;帶 `rev` 條件,算的途中有新收付就不寫)
 * - `closedAsOf` = 從這個時點起沒有待結清:某個時點的待結清(輸出報表的期末)只要算 `closedAsOf` 為 null
 *   或不早於那個時點的單據
 */
@Schema({ collection: LOTTERY_SETTLEMENT_MARKS_COLLECTION, timestamps: true })
export class LotterySettlementMark {
  /** 單據的歸屬組織(= 提交的 `orgId`;租戶隔離,ADR-0005)。讀寫一律用租戶邊界上下文。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 單據的模組 key(收付登記的 `moduleKey`;= 交易 / 流水的 `refType`)。 */
  @Prop({ type: String, required: true })
  refType!: string;

  /** 單據(表單提交 id)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  refId!: Types.ObjectId;

  /** 從這個時點起沒有待結清;null = 還要算(剛完成、或之後又有收付)。 */
  @Prop({ type: Date, default: null })
  closedAsOf!: Date | null;

  /** 每次改回 null 就 +1(寫 `closedAsOf` 時比對,算的途中有新收付就不寫)。 */
  @Prop({ type: Number, default: 0 })
  rev!: number;

  /** 模組 key(plugin 宣告;本表固定 `accounts`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotterySettlementMarkSchema = SchemaFactory.createForClass(
  LotterySettlementMark,
);

// 一張單據一筆
LotterySettlementMarkSchema.index({ refId: 1 }, { unique: true });
// 還要算的(`closedAsOf` null 或不早於某個時點)
LotterySettlementMarkSchema.index({ tenantId: 1, refType: 1, closedAsOf: 1 });
LotterySettlementMarkSchema.plugin(baseFieldsPlugin);
LotterySettlementMarkSchema.plugin(tenantScopePlugin, { moduleData: true });
LotterySettlementMarkSchema.path("moduleKey").default(ACCOUNTS_KEY);
