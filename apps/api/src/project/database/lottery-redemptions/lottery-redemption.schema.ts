import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  REDEMPTION_STATUSES,
  type RedemptionStatus,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_REDEMPTIONS_COLLECTION = "lottery_redemptions";

/**
 * 兌獎紀錄(專案規格 6.5、6.12、8.2;正本 `docs/modules/project/store.md`「兌獎」)。錢從那一班的抽屜付出;
 * 抽屜應有不存數字,由登記的來源 `redemptions` 從這張表加總(`lottery/redemption/redemption-registrations.ts`)。
 *
 * **同一張不能兌兩次**:部分唯一索引 `(tenantId, gameCode, bookNo, ticketNo)`,只限未撤銷的
 * (`revokedAt` 為 null);撤銷後可以重新登記同一張。
 *
 * **事後更正**(規格 6.12):那一班已結帳之後的撤銷記 `revokePostCloseOf`、之後的新增([撤銷並重新登記])
 * 記 `postCloseOf`,都指向那一班;結帳單不改。
 */
@Schema({ collection: LOTTERY_REDEMPTIONS_COLLECTION, timestamps: true })
export class LotteryRedemption {
  /**
   * 單號 `RD-0001`(底座 `SerialService`,key `lottery_redemption`,各租戶各自連號、不分期;新增時在同一個交易內
   * 取號,撤銷不收回)。加單號之前的舊資料 = null(畫面顯示「—」)。
   */
  @Prop({ type: String, default: null })
  serialNo!: string | null;

  /** 分店(錢從這家店的抽屜付出)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  shiftId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  cashPointId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  redeemedAt!: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  redeemedBy!: Types.ObjectId;

  /** 遊戲代號 4 位。 */
  @Prop({ type: String, required: true })
  gameCode!: string;

  /** 本號 7 位。 */
  @Prop({ type: String, required: true })
  bookNo!: string;

  /** 張號 3 位。 */
  @Prop({ type: String, required: true })
  ticketNo!: string;

  /** 顯示用張編號 `5164-056527-031`(lookup 的標籤)。 */
  @Prop({ type: String, required: true })
  ticketLabel!: string;

  /** 刷到 / 輸入的原文(建議刷背面編號)。 */
  @Prop({ type: String, required: true })
  rawInput!: string;

  /** 本店的張;不是本店的刮刮樂 = null。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  ticketId!: Types.ObjectId | null;

  /** 遊戲(本租戶找得到這個代號時);找不到 = null。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  gameId!: Types.ObjectId | null;

  /** 中獎金額(元,正整數,≤ 5,000)。 */
  @Prop({ type: Number, required: true, min: 1 })
  prizeAmount!: number;

  @Prop({ type: String, enum: REDEMPTION_STATUSES, required: true })
  status!: RedemptionStatus;

  /** 勾進哪一張進貨單(已送兌);店內持有 = null。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  purchaseSubmissionId!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  /**
   * 送兌的歷程(每次勾進進貨單一筆;退回 / 駁回 / 作廢 / 沒勾回到店內持有時記 `releasedAt`):營運報表判斷
   * 期末那一刻是不是已送兌(重跑舊報表數字不變;使用者 10/27 定案)。重送同一張單不另記。
   */
  @Prop({
    type: [
      {
        _id: false,
        sentAt: { type: Date, required: true },
        releasedAt: { type: Date, default: null },
        purchaseSubmissionId: {
          type: MongooseSchema.Types.ObjectId,
          required: true,
        },
      },
    ],
    default: [],
  })
  sentHistory!: {
    sentAt: Date;
    releasedAt: Date | null;
    purchaseSubmissionId: Types.ObjectId;
  }[];

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  revokedBy!: Types.ObjectId | null;

  /** 撤銷原因:欄位管理「撤銷兌獎原因」的選項值;自己當下撤銷固定 `immediate`。 */
  @Prop({ type: String, default: null })
  revokeReasonKey!: string | null;

  /** 撤銷原因的名稱快照(選項改名不影響紀錄)。 */
  @Prop({ type: String, default: null })
  revokeReason!: string | null;

  /** 撤銷說明。 */
  @Prop({ type: String, default: null })
  revokeNote!: string | null;

  /** [撤銷並重新登記] 的新紀錄指向被撤銷的那筆。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  replacesId!: Types.ObjectId | null;

  /** 新增時那一班已結帳 → 那一班(事後更正)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  postCloseOf!: Types.ObjectId | null;

  /** 撤銷時那一班已結帳 → 那一班(事後更正)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  revokePostCloseOf!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  /** 狀態改變的條件更新用(撤銷 / 送兌 / 回到店內持有各 +1)。 */
  @Prop({ type: Number, required: true, default: 0 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `store`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryRedemptionSchema =
  SchemaFactory.createForClass(LotteryRedemption);

// 同一張未撤銷的不能兌兩次;撤銷後可以重新登記
LotteryRedemptionSchema.index(
  { tenantId: 1, gameCode: 1, bookNo: 1, ticketNo: 1 },
  {
    unique: true,
    partialFilterExpression: {
      revokedAt: { $type: "null" },
      deletedAt: { $type: "null" },
    },
  },
);
// 兌獎紀錄分頁的單號搜尋(完全比對)
LotteryRedemptionSchema.index({ tenantId: 1, serialNo: 1 });
LotteryRedemptionSchema.index({ shiftId: 1 });
LotteryRedemptionSchema.index({ orgId: 1, redeemedAt: -1 });
LotteryRedemptionSchema.index({ tenantId: 1, purchaseSubmissionId: 1 });
LotteryRedemptionSchema.index({ postCloseOf: 1 });
LotteryRedemptionSchema.index({ revokePostCloseOf: 1 });
LotteryRedemptionSchema.plugin(baseFieldsPlugin);
// 資料共用 private(ADR-0014):總部看得到分店的兌獎靠可見範圍「包含下層」
LotteryRedemptionSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryRedemptionSchema.path("moduleKey").default(STORE_KEY);
