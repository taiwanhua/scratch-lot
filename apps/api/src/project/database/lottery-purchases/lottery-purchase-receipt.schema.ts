import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { PURCHASE_MODULE_KEY } from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_PURCHASE_RECEIPTS_COLLECTION = "lottery_purchase_receipts";

/**
 * 進貨點收(專案規格 8.3;正本 `docs/modules/project/purchasing.md`「進貨單」):店長在審核頁逐本刷條碼,
 * 一本一筆(唯一 `(submissionId, rowId)`),同一個交易建立本、張與「進貨」事件。
 * 「已點收的列不能被改或刪」以 `rowId` 比對;核准前要全部點收;有點收就不能駁回 / 刪除。
 * [完成這次點收] 時把「這一次」點收的列標上同一個點收批次(`batchId`),進貨點收單照批次印、補印照批次重排版。
 */
@Schema({ collection: LOTTERY_PURCHASE_RECEIPTS_COLLECTION, timestamps: true })
export class LotteryPurchaseReceipt {
  /** 進貨分店(點收的店;本的所在分店)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 進貨單(表單提交 id)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  submissionId!: Types.ObjectId;

  /** 明細列的 rowId。 */
  @Prop({ type: String, required: true })
  rowId!: string;

  /** 點收時建立的本。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookId!: Types.ObjectId;

  /** 點收人。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  receivedBy!: Types.ObjectId;

  /** 點收時間。 */
  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  /**
   * 點收批次:[完成這次點收] 時給「這一次」點收的列同一個 id(進貨點收單的列印紀錄 `refId`)。
   * 還沒按 [完成這次點收] 的列(以及這個欄位加上之前點收的舊資料)是 null。
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  batchId!: Types.ObjectId | null;

  /** 按 [完成這次點收] 的時間(批次的順序依它);沒有批次 = null。 */
  @Prop({ type: Date, default: null })
  batchedAt!: Date | null;

  /** 模組 key(plugin 宣告;本表固定 `purchasing.purchase`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryPurchaseReceiptSchema = SchemaFactory.createForClass(
  LotteryPurchaseReceipt,
);

// 一張進貨單的一列只能點收一次
LotteryPurchaseReceiptSchema.index(
  { submissionId: 1, rowId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryPurchaseReceiptSchema.index({ orgId: 1, receivedAt: 1 });
LotteryPurchaseReceiptSchema.plugin(baseFieldsPlugin);
// 資料共用 private(ADR-0014):總部看得到分店的點收靠可見範圍「包含下層」
LotteryPurchaseReceiptSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryPurchaseReceiptSchema.path("moduleKey").default(PURCHASE_MODULE_KEY);
