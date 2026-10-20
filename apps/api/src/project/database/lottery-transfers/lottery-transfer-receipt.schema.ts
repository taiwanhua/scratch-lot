import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { TRANSFER_MODULE_KEY } from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import {
  type ShareOrg,
  tenantScopePlugin,
} from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_TRANSFER_RECEIPTS_COLLECTION = "lottery_transfer_receipts";

/** 點收時搬進來的一張,與它調入前的單張成本(作廢時改回)。 */
@Schema({ _id: false })
export class LotteryTransferReceiptTicket {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  ticketId!: Types.ObjectId;

  /** 調入前的單張成本(調入改成這一列的批購金額 ÷ 張數)。 */
  @Prop({ type: Number, required: true })
  unitCost!: number;
}

const LotteryTransferReceiptTicketSchema = SchemaFactory.createForClass(
  LotteryTransferReceiptTicket,
);

/**
 * 調貨點收(專案規格 8.4「點收一本」;正本 `docs/modules/project/purchasing.md`「調貨單」):收貨店店長在
 * 第二關逐本刷條碼,一列一筆(唯一 `(submissionId, rowId)`),同一個交易把這列的張改成收貨店庫存、寫「調入」事件。
 * 「已點收的列不能被改或刪」以 `rowId` 比對;核准前要全部點收;有點收就不能駁回 / 刪除;作廢時照 `tickets`
 * 把張搬回出貨店、單張成本改回。
 *
 * 資料共用(ADR-0014):歸屬收貨店(`orgId`),出貨店以 `sharedByFields: fromOrgId` 看得到(兩邊店都看得到;寫入不放大)。
 */
@Schema({ collection: LOTTERY_TRANSFER_RECEIPTS_COLLECTION, timestamps: true })
export class LotteryTransferReceipt {
  /** 收貨分店(點收的店)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 出貨分店(資料共用:出貨店也看得到)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  fromOrgId!: Types.ObjectId;

  /** 調貨單(表單提交 id)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  submissionId!: Types.ObjectId;

  /** 明細列的 rowId。 */
  @Prop({ type: String, required: true })
  rowId!: string;

  /** 這列的本。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookId!: Types.ObjectId;

  /** 點收時這一列的批購金額(重新送出時比對「已點收的列沒被改」)。 */
  @Prop({ type: Number, required: true })
  purchaseAmount!: number;

  /** 搬進來的張與調入前的單張成本。 */
  @Prop({ type: [LotteryTransferReceiptTicketSchema], default: [] })
  tickets!: LotteryTransferReceiptTicket[];

  /** 點收人。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  receivedBy!: Types.ObjectId;

  /** 點收時間。 */
  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  /** 模組 key(plugin 宣告;本表固定 `purchasing.transfer`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;

  /** 共用清單(plugin 宣告;本表固定空清單,出貨店靠 `sharedByFields` 看得到)。 */
  shareOrgs!: ShareOrg[];
}

export const LotteryTransferReceiptSchema = SchemaFactory.createForClass(
  LotteryTransferReceipt,
);

// 一張調貨單的一列只能點收一次
LotteryTransferReceiptSchema.index(
  { submissionId: 1, rowId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryTransferReceiptSchema.index({ orgId: 1, receivedAt: 1 });
// 資料共用的 sharedByFields 要有 { tenantId, <欄位> } 開頭的索引
LotteryTransferReceiptSchema.index({ tenantId: 1, fromOrgId: 1 });
LotteryTransferReceiptSchema.plugin(baseFieldsPlugin);
LotteryTransferReceiptSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: {
    mode: "shareable",
    defaultShareOrgs: "none",
    editable: false,
    sharedByFields: [{ path: "fromOrgId", includeDescendants: false }],
  },
});
LotteryTransferReceiptSchema.path("moduleKey").default(TRANSFER_MODULE_KEY);
