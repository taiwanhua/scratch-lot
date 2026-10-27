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

  /** 張號(3 位;逐張點收後比對「哪幾張到了」用)。這個欄位加上之前的舊紀錄沒有(= 整列一次點收)。 */
  @Prop({ type: String, default: null })
  ticketNo!: string | null;
}

const LotteryTransferReceiptTicketSchema = SchemaFactory.createForClass(
  LotteryTransferReceiptTicket,
);

/**
 * 調貨點收(專案規格 8.4「點收一本」;正本 `docs/modules/project/purchasing.md`「調貨單」):收貨店店長在
 * 第二關點收,**一次點收一筆**(整本的列刷一張 = 整列一筆;選張的列逐張點收,刷一張 / 點選幾格 / 其餘全部到齊
 * 各一筆),`tickets` 列出這一次搬進來的張;同一個交易把這些張改成收貨店庫存、寫「調入」事件。
 * 一列已點收幾張 = 這一列各筆的 `tickets` 合計(全部到齊 = 這一列的張數);同一張不會點收兩次(張在途 → 庫存,
 * 帳本的版本條件更新擋第二次)。`purchaseAmount` = 這一次的張的批購金額(這一列各筆合計 = 已點收的批購金額,
 * 報表的調入 / 調出金額照它加總)。已點收的張不能被移出這一列;核准前要全部點收;有點收就不能駁回 / 刪除;
 * 作廢時照 `tickets` 把張搬回出貨店、單張成本改回。
 * [完成這次點收] 時把「這一次」點收的列標上同一個點收批次(`batchId`),調貨點收單照批次印、補印照批次重排版(同進貨點收)。
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

  /**
   * 這一次點收的張的批購金額:這一列已點收金額(`receivedLineAmountOf`)點收後 − 點收前,整數元;
   * 這一列各筆合計 = 已點收的批購金額(全部到齊 = 這一列的批購金額)。
   */
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

  /**
   * 點收批次:[完成這次點收] 時給「這一次」點收的紀錄同一個 id(調貨點收單的列印紀錄 `refId`)。
   * 還沒按 [完成這次點收] 的紀錄(以及這個欄位加上之前點收的舊資料)是 null。
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  batchId!: Types.ObjectId | null;

  /** 按 [完成這次點收] 的時間(批次的順序依它);沒有批次 = null。 */
  @Prop({ type: Date, default: null })
  batchedAt!: Date | null;

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

// 一張調貨單的點收紀錄(一列可以有好幾筆:逐張點收)。舊的 (submissionId, rowId) 唯一索引由 migration 拿掉
LotteryTransferReceiptSchema.index({ submissionId: 1, rowId: 1 });
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
