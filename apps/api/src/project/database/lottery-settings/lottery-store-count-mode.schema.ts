import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  COUNT_MODES,
  COUNT_MODE_CHANGE_CAUSES,
  type CountMode,
  type CountModeChangeCause,
  STOCKTAKE_TYPES,
  STORE_KEY,
  type StocktakeType,
} from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_STORE_COUNT_MODES_COLLECTION = "lottery_store_count_modes";

/** 盤點制度歷程的一筆(規格 5.6 `history[]`;設定頁的 [變更紀錄],報表靠它判斷期間內哪一段是哪種制度)。 */
export interface CountModeHistoryEntry {
  from: CountMode | null;
  to: CountMode;
  at: Date;
  /** 誰(補點編號核准時是核准的人;系統寫入為 null) */
  by: Types.ObjectId | null;
  cause: CountModeChangeCause;
  /** 補點編號的盤點單(`renumber_approved`);其他為 null */
  stocktakeId: Types.ObjectId | null;
}

/** 進行中的全店重刷(gameId = 那個遊戲)或補點編號(gameId = null)(規格 5.6 `movePauses[]`、8.5)。 */
export interface CountModeMovePause {
  stocktakeId: Types.ObjectId;
  gameId: Types.ObjectId | null;
}

/** 盤點中登記(規格 5.6 `stocktakeSessions[]`、8.5a)。 */
export interface CountModeStocktakeSession {
  sessionId: string;
  /** 交班 / 日結 / 臨時(接續時回到哪個畫面、被擋時寫「交班盤點 · 店內櫃台」) */
  type: StocktakeType;
  /** 登記的位置:單一收銀點 = 那台;全店 = 全部收銀點(庫存以 null 表示) */
  cashPointIds: (Types.ObjectId | null)[];
  by: Types.ObjectId;
  startedAt: Date;
  /** 最後一次操作;超過 1 小時沒操作就失效(`isStocktakeSessionActive`) */
  lastActiveAt: Date;
  /** 盤點進度(`serializeStocktakeDraft` 的字串);接續用 */
  draft: string | null;
  /** 店長 [結束這個盤點] 的時間與人(進度保留,本人回來仍可 [繼續]);null = 沒被結束 */
  endedAt: Date | null;
  endedBy: Types.ObjectId | null;
}

/**
 * 分店實際的盤點制度(張數店規格 5.6):一店一筆,比照 `lottery_vault_locks`(`orgId` 唯一、`version`、
 * `moduleKey: store`)與 `sentHistory[]` 的內嵌歷程。**沒有筆或 `mode` 空 = 編號店**。
 *
 * - 誰讀:一律經 `StoreCountModeService`(`modeOf`、`settingOf`、`movePauseOf`、`busyOf`)
 * - 誰寫:刮刮樂設定改盤點制度(`count_mode` 同一個交易重算下層分店)、[取消轉換];
 *   之後的補點編號核准(T8)、全店重刷與補點的移櫃暫停(T6、T8)、盤點中登記(T4)寫同一筆
 * - `version`:開始 / 結束重刷、移櫃、登記 / 解除盤點中都 `$inc`,讓兩邊一定有先後(8.5、8.5a)
 */
@Schema({ collection: LOTTERY_STORE_COUNT_MODES_COLLECTION, timestamps: true })
export class LotteryStoreCountMode {
  /** 分店。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** `numbered` / `count` / `converting`;null = 編號店(只有盤點中登記、還沒設過制度的筆)。 */
  @Prop({ type: String, enum: [...COUNT_MODES, null], default: null })
  mode!: CountMode | null;

  /** 進入現在制度的時間。 */
  @Prop({ type: Date, default: null })
  since!: Date | null;

  /** 上次補點編號核准的時間。 */
  @Prop({ type: Date, default: null })
  lastRenumberAt!: Date | null;

  /** 上次補點編號的盤點單。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  lastRenumberStocktakeId!: Types.ObjectId | null;

  /** 盤點制度歷程(只加不改)。 */
  @Prop({
    type: [
      {
        _id: false,
        from: { type: String, enum: [...COUNT_MODES, null], default: null },
        to: { type: String, enum: COUNT_MODES, required: true },
        at: { type: Date, required: true },
        by: { type: MongooseSchema.Types.ObjectId, default: null },
        cause: { type: String, enum: COUNT_MODE_CHANGE_CAUSES, required: true },
        stocktakeId: { type: MongooseSchema.Types.ObjectId, default: null },
      },
    ],
    default: [],
  })
  history!: CountModeHistoryEntry[];

  /** 進行中的全店重刷或補點編號;空 = 不暫停移櫃。 */
  @Prop({
    type: [
      {
        _id: false,
        stocktakeId: { type: MongooseSchema.Types.ObjectId, required: true },
        gameId: { type: MongooseSchema.Types.ObjectId, default: null },
      },
    ],
    default: [],
  })
  movePauses!: CountModeMovePause[];

  /** 盤點中登記(編號店也登記)。 */
  @Prop({
    type: [
      {
        _id: false,
        sessionId: { type: String, required: true },
        type: { type: String, enum: STOCKTAKE_TYPES, default: "adhoc" },
        cashPointIds: {
          type: [MongooseSchema.Types.ObjectId],
          default: [],
        },
        by: { type: MongooseSchema.Types.ObjectId, required: true },
        startedAt: { type: Date, required: true },
        lastActiveAt: { type: Date, required: true },
        draft: { type: String, default: null },
        endedAt: { type: Date, default: null },
        endedBy: { type: MongooseSchema.Types.ObjectId, default: null },
      },
    ],
    default: [],
  })
  stocktakeSessions!: CountModeStocktakeSession[];

  /** 開始 / 結束重刷、移櫃、登記 / 解除盤點中都加 1(製造寫入衝突,8.5)。 */
  @Prop({ type: Number, default: 0 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `store`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryStoreCountModeSchema = SchemaFactory.createForClass(
  LotteryStoreCountMode,
);

LotteryStoreCountModeSchema.index({ orgId: 1 }, { unique: true });
LotteryStoreCountModeSchema.plugin(baseFieldsPlugin);
LotteryStoreCountModeSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryStoreCountModeSchema.path("moduleKey").default(STORE_KEY);
