import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import {
  type ShareOrg,
  tenantScopePlugin,
} from "../../../database/plugins/tenant-scope.plugin";
import { INVENTORY_MODULE_KEY } from "./inventory-module-key";

export const LOTTERY_BOOKS_COLLECTION = "lottery_books";

/** 本的狀態:正常 / 已撤銷(進貨單作廢 → 已撤銷,另寫「進貨作廢」事件)。 */
export const BOOK_STATUSES = ["normal", "revoked"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

/**
 * 本(專案規格 7.1;正本 `docs/modules/project/inventory.md`「資料與帳本」)。只在進貨點收時建立
 * (`LotteryBooksService.createBook`),之後的狀態變化只經帳本服務。
 *
 * `orgId` = **所在分店**(整本調貨時由帳本服務以底座的搬家入口 `reassignOrg` 改)。持有這本任何一張的
 * 分店也看得到這本(規格「讀取放行」):資料共用的 `sharedByFields: holderOrgIds`。
 * 待標註、剩餘、各分店持有張數、未拆 / 檯面中 / 售完都**即時計算不存**(`@repo/domain/project/lottery`)。
 */
@Schema({ collection: LOTTERY_BOOKS_COLLECTION, timestamps: true })
export class LotteryBook {
  /** 所在分店(租戶隔離,ADR-0005);整本調貨時以 `reassignOrg` 改。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 遊戲。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  gameId!: Types.ObjectId;

  /** 遊戲代號快照(4 位)。 */
  @Prop({ type: String, required: true })
  gameCode!: string;

  /** 本號:7 位數字(輸入 6 位自動補 0;開頭 0 時顯示 6 位)。 */
  @Prop({ type: String, required: true })
  bookNo!: string;

  /** 本編號 `5164-0056527`:租戶內唯一(未刪除的);顯示 `5164-056527`。 */
  @Prop({ type: String, required: true })
  bookKey!: string;

  /** 印刷版別,預設 "1"。 */
  @Prop({ type: String, default: "1" })
  printVersion!: string;

  /** 持有這本任何一張(不算跳號)的分店:讀取放行用,帳本服務在張換分店時重算。 */
  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] })
  holderOrgIds!: Types.ObjectId[];

  /** 進貨快照:進貨單(表單提交)id。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  purchaseSubmissionId!: Types.ObjectId | null;

  /** 進貨快照:批購日。 */
  @Prop({ type: Date, default: null })
  purchasedAt!: Date | null;

  /** 進貨快照:進貨甲類。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  purchaseDealerId!: Types.ObjectId | null;

  /** 批購金額率(整數 %,快照)。 */
  @Prop({ type: Number, required: true })
  rate!: number;

  /** 成本(元,快照;小數四捨五入)。 */
  @Prop({ type: Number, required: true })
  cost!: number;

  /** 標準張數快照(遊戲的整本張數);待標註張數 = 迄號 − 標準張數 − 已標跳號。 */
  @Prop({ type: Number, required: true })
  standardTickets!: number;

  /** 起號,一律 "001"。 */
  @Prop({ type: String, default: "001" })
  firstTicketNo!: string;

  /** 迄號(3 位):≥ 標準張數且 ≤ 999。 */
  @Prop({ type: String, required: true })
  lastTicketNo!: string;

  /** 跳號(拆本時標註;數量 = 待標註張數;標錯時在本的詳情頁更正)。 */
  @Prop({ type: [String], default: [] })
  skippedTicketNos!: string[];

  /** 被單據鎖定的張數(lookup 篩「未被鎖定」= 0;`lockTickets` / `unlockTickets` 維護)。 */
  @Prop({ type: Number, default: 0 })
  lockedTicketCount!: number;

  /** 正常 / 已撤銷。 */
  @Prop({ type: String, enum: BOOK_STATUSES, default: "normal" })
  status!: BookStatus;

  /** 模組 key(plugin 宣告;本表固定 `inventory`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;

  /** 共用清單(plugin 宣告;本表固定空清單,持有分店靠 `sharedByFields` 看得到)。 */
  shareOrgs!: ShareOrg[];
}

export const LotteryBookSchema = SchemaFactory.createForClass(LotteryBook);

// 本編號租戶內唯一(只算未刪除的)
LotteryBookSchema.index(
  { tenantId: 1, bookKey: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryBookSchema.index({ tenantId: 1, gameId: 1 });
LotteryBookSchema.index({ orgId: 1, gameId: 1 });
// 資料共用的 sharedByFields 要有 { tenantId, <欄位> } 開頭的索引
LotteryBookSchema.index({ tenantId: 1, holderOrgIds: 1 });
LotteryBookSchema.plugin(baseFieldsPlugin);
LotteryBookSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: {
    mode: "shareable",
    defaultShareOrgs: "none",
    editable: false,
    sharedByFields: [{ path: "holderOrgIds", includeDescendants: false }],
  },
});
LotteryBookSchema.path("moduleKey").default(INVENTORY_MODULE_KEY);
