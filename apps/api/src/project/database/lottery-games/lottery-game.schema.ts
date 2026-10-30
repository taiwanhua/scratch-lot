import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  GAME_STATUS,
  GAME_STATUSES,
  type GameStatus,
} from "@repo/domain/project/lottery-master-data";
import { TAG_PALETTE_KEYS } from "@repo/domain/tag-palette";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import {
  type ShareOrg,
  tenantScopePlugin,
} from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_GAMES_COLLECTION = "lottery_games";

/** 本表固定屬於檔案管理(`tenantScopePlugin` 的 `moduleData`)。 */
export const MASTER_DATA_MODULE_KEY = "master-data";

/**
 * 遊戲(專案規格 5.1;欄位規則正本 `docs/modules/project/master-data.md`「資料」)。
 * 遊戲是**整個租戶共用的主檔**:資料共用宣告「可共用、預設全部分店、清單固定」(ADR-0014),
 * `orgId` = 建立時的當前組織;整個租戶的分店都看得到,只有歸屬組織在可見範圍內的人改得到。
 */
@Schema({ collection: LOTTERY_GAMES_COLLECTION, timestamps: true })
export class LotteryGame {
  /** 建立時的當前組織(租戶隔離,ADR-0005;修改 / 刪除照它的可見範圍)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 遊戲代號:4 碼數字(`GAME_CODE_PATTERN`),租戶內唯一(service 檢查);有庫存後鎖定。 */
  @Prop({ type: String, required: true })
  gameCode!: string;

  /** 遊戲名稱(30 字內)。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 單張金額(正整數);有庫存後鎖定。 */
  @Prop({ type: Number, required: true })
  unitPrice!: number;

  /** 整本張數(1–999);有庫存後鎖定。 */
  @Prop({ type: Number, required: true })
  ticketsPerBook!: number;

  /** 整本金額 = 單張金額 × 整本張數,api 計算後存。 */
  @Prop({ type: Number, required: true })
  bookPrice!: number;

  /** 預設批購金額率(整數 %,0–100)。 */
  @Prop({ type: Number, required: true })
  defaultRate!: number;

  /** 顏色:標籤色票代號(`@repo/domain/tag-palette`);null = 不設定。 */
  @Prop({ type: String, enum: [...TAG_PALETTE_KEYS, null], default: null })
  color!: string | null;

  /** 狀態:販售中 / 停售。停售的遊戲不能出現在新的叫貨單與進貨單(由那兩張單據檢查)。 */
  @Prop({
    type: String,
    enum: GAME_STATUSES,
    default: GAME_STATUS.onSale,
  })
  status!: GameStatus;

  /** 上市日(時點 = 租戶時區那一天 00:00):api 由兌獎截止日推算(− 9 個月)後存;驅動【新】標記。 */
  @Prop({ type: Date, default: null })
  launchedAt!: Date | null;

  /** 停售日:api 由兌獎截止日推算(− 3 個月)後存;只是記錄,不自動改狀態。 */
  @Prop({ type: Date, default: null })
  discontinuedAt!: Date | null;

  /** 兌獎截止日(新增 / 編輯必填;時點 = 租戶時區那一天 00:00)。舊資料可能是 null(不寫遷移)。 */
  @Prop({ type: Date, default: null })
  claimDeadline!: Date | null;

  /** 備註(1000 字內)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `master-data`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告;`BaseRepository.create` 推導,根組織為 null)。 */
  tenantId!: Types.ObjectId | null;

  /** 共用給(plugin 宣告;固定為全部分店 `[{ 租戶頂層, 含下層 }]`,一般更新改不了)。 */
  shareOrgs!: ShareOrg[];
}

export const LotteryGameSchema = SchemaFactory.createForClass(LotteryGame);

LotteryGameSchema.index({ orgId: 1, createdAt: 1 });
// 代號租戶內唯一,只算未刪除的(軟刪除後代號可再用;刪除的 `deletedAt` 是時點,不在索引裡)。
// service 先查,這裡守同時送出(`$type: "null"`:partial index 不收 `deletedAt: null` 的等值寫法)
LotteryGameSchema.index(
  { tenantId: 1, gameCode: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryGameSchema.plugin(baseFieldsPlugin);
// 可共用、預設全部分店、清單固定(ADR-0014);代號 / 名稱可經租戶內引用名稱出口讀
LotteryGameSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: {
    mode: "shareable",
    defaultShareOrgs: "wholeTenant",
    editable: false,
  },
  refFields: ["gameCode", "name"],
});
LotteryGameSchema.path("moduleKey").default(MASTER_DATA_MODULE_KEY);
