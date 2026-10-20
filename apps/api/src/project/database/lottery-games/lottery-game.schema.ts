import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  GAME_STATUS,
  GAME_STATUSES,
  type GameStatus,
} from "@repo/domain/project/lottery-master-data";
import { TAG_PALETTE_KEYS } from "@repo/domain/project/tag-palette";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_GAMES_COLLECTION = "lottery_games";

/** 本表固定屬於檔案管理(`tenantScopePlugin` 的 `moduleData`)。 */
export const MASTER_DATA_MODULE_KEY = "master-data";

/**
 * 遊戲(專案規格 5.1;欄位規則正本 `docs/modules/project/master-data.md`「資料」)。
 * 遊戲是**整個租戶共用的主檔**:`orgId` 一律是租戶頂層(根組織建的是根組織),
 * 讀取以 `tenantId` 釘在操作者的租戶上(`lottery/games/game-tenant.ts`)。
 */
@Schema({ collection: LOTTERY_GAMES_COLLECTION, timestamps: true })
export class LotteryGame {
  /** 租戶頂層(租戶隔離,ADR-0005);根組織建的遊戲是根組織。 */
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

  /** 顏色:標籤色票代號(`@repo/domain/project/tag-palette`);null = 不設定。 */
  @Prop({ type: String, enum: [...TAG_PALETTE_KEYS, null], default: null })
  color!: string | null;

  /** 狀態:販售中 / 停售。停售的遊戲不能出現在新的叫貨單與進貨單(由那兩張單據檢查)。 */
  @Prop({
    type: String,
    enum: GAME_STATUSES,
    default: GAME_STATUS.onSale,
  })
  status!: GameStatus;

  /** 上市日(時點;admin 以租戶時區的當天 00:00 送)。 */
  @Prop({ type: Date, default: null })
  launchedAt!: Date | null;

  /** 停售日。 */
  @Prop({ type: Date, default: null })
  discontinuedAt!: Date | null;

  /** 兌獎截止日。 */
  @Prop({ type: Date, default: null })
  claimDeadline!: Date | null;

  /** 備註(1000 字內)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `master-data`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告;`BaseRepository.create` 推導,根組織為 null)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryGameSchema = SchemaFactory.createForClass(LotteryGame);

LotteryGameSchema.index({ orgId: 1, createdAt: 1 });
LotteryGameSchema.index({ tenantId: 1, gameCode: 1 });
LotteryGameSchema.plugin(baseFieldsPlugin);
LotteryGameSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryGameSchema.path("moduleKey").default(MASTER_DATA_MODULE_KEY);
