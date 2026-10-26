import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  STOCKTAKE_DIFF_ACTIONS,
  STOCKTAKE_DIFF_KINDS,
  STOCKTAKE_LOST_ACTIONS,
  STOCKTAKE_METHODS,
  STOCKTAKE_STATUSES,
  STOCKTAKE_TYPES,
  STORE_KEY,
  type StocktakeDiffAction,
  type StocktakeDiffKind,
  type StocktakeLostAction,
  type StocktakeMethod,
  type StocktakeStatus,
  type StocktakeType,
} from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_STOCKTAKES_COLLECTION = "lottery_stocktakes";

/** 一張有差異的張與它的處理。 */
export interface StocktakeDiffRow {
  ticketId: Types.ObjectId;
  ticketNo: string;
  kind: StocktakeDiffKind;
  action: StocktakeDiffAction;
  /** 補登售出寫的售出事件 id;其他 = null。 */
  eventId: string | null;
  /** 補登售出記成那一班的事後更正(那個收銀點沒有開著的班)。 */
  postClose: boolean;
  /** 面額(補登售出的金額)。 */
  amount: number;
}

/** 一本 × 收銀點。 */
export interface StocktakeLine {
  bookId: Types.ObjectId;
  gameCode: string;
  gameName: string;
  bookNo: string;
  cashPointId: Types.ObjectId;
  countedAt: Date;
  method: StocktakeMethod;
  /** 盤到那一刻的系統數字(這個收銀點檯面上未售的張數)。 */
  systemCount: number;
  /** 實盤(點到 / 刷到的張數)。 */
  presentTicketNos: string[];
  diffs: StocktakeDiffRow[];
}

/** 未拆的本:在 / 不在(不在 → 完成時待查)。 */
export interface StocktakeUnopenedLine {
  bookId: Types.ObjectId;
  gameCode: string;
  gameName: string;
  bookNo: string;
  ticketCount: number;
  present: boolean;
}

/** 待查清單的處理。 */
export interface StocktakeLostReviewLine {
  ticketId: Types.ObjectId;
  bookId: Types.ObjectId;
  label: string;
  action: StocktakeLostAction;
  reasonKey: string | null;
  reasonLabel: string | null;
  reasonNote: string | null;
  /** 單張成本(確認遺失的批購成本)。 */
  unitCost: number;
}

/**
 * 送出時盤點範圍內還沒盤的本(一本 × 收銀點;使用者 2026-10-21 定案:沒盤完可以送出,盤點單記下沒盤的本)。
 * 不比對、不記差異,張維持系統狀態;退回後再送出時重算。
 */
export interface StocktakeUncountedBook {
  bookId: Types.ObjectId;
  gameCode: string;
  gameName: string;
  bookNo: string;
  cashPointId: Types.ObjectId;
}

export interface StocktakeSummary {
  books: number;
  backfillCount: number;
  backfillAmount: number;
  newInvestigate: number;
  flagged: number;
  confirmLost: number;
  confirmLostCost: number;
  /** 送出時還沒盤的本數(`uncountedBooks.length`;報表讀這裡)。 */
  uncountedCount: number;
}

const OBJECT_ID = MongooseSchema.Types.ObjectId;

const DIFF_TYPE = {
  _id: false,
  ticketId: { type: OBJECT_ID, required: true },
  ticketNo: { type: String, required: true },
  kind: { type: String, enum: STOCKTAKE_DIFF_KINDS, required: true },
  action: { type: String, enum: STOCKTAKE_DIFF_ACTIONS, required: true },
  eventId: { type: String, default: null },
  postClose: { type: Boolean, default: false },
  amount: { type: Number, default: 0 },
};

const LINE_TYPE = {
  _id: false,
  bookId: { type: OBJECT_ID, required: true },
  gameCode: { type: String, required: true },
  gameName: { type: String, default: "" },
  bookNo: { type: String, required: true },
  cashPointId: { type: OBJECT_ID, required: true },
  countedAt: { type: Date, required: true },
  method: { type: String, enum: STOCKTAKE_METHODS, required: true },
  systemCount: { type: Number, default: 0 },
  presentTicketNos: { type: [String], default: [] },
  diffs: { type: [DIFF_TYPE], default: [] },
};

const UNOPENED_TYPE = {
  _id: false,
  bookId: { type: OBJECT_ID, required: true },
  gameCode: { type: String, required: true },
  gameName: { type: String, default: "" },
  bookNo: { type: String, required: true },
  ticketCount: { type: Number, default: 0 },
  present: { type: Boolean, required: true },
};

const LOST_REVIEW_TYPE = {
  _id: false,
  ticketId: { type: OBJECT_ID, required: true },
  bookId: { type: OBJECT_ID, required: true },
  label: { type: String, required: true },
  action: { type: String, enum: STOCKTAKE_LOST_ACTIONS, required: true },
  reasonKey: { type: String, default: null },
  reasonLabel: { type: String, default: null },
  reasonNote: { type: String, default: null },
  unitCost: { type: Number, default: 0 },
};

const UNCOUNTED_TYPE = {
  _id: false,
  bookId: { type: OBJECT_ID, required: true },
  gameCode: { type: String, required: true },
  gameName: { type: String, default: "" },
  bookNo: { type: String, required: true },
  cashPointId: { type: OBJECT_ID, required: true },
};

const SUMMARY_TYPE = {
  _id: false,
  books: { type: Number, default: 0 },
  backfillCount: { type: Number, default: 0 },
  backfillAmount: { type: Number, default: 0 },
  newInvestigate: { type: Number, default: 0 },
  flagged: { type: Number, default: 0 },
  confirmLost: { type: Number, default: 0 },
  confirmLostCost: { type: Number, default: 0 },
  uncountedCount: { type: Number, default: 0 },
};

/**
 * 盤點單(專案規格 6.8、8.6;正本 `docs/modules/project/store.md`「盤點」)。**送出時才建立**(沒有「盤點中」):
 * 臨時盤點由盤點確認申請送出時建立、交班 / 日結的盤點由結帳確認申請送出時在同一個交易建立
 * (`StocktakeService.submitStocktakeDraft`);一張單據一筆(`submissionId` 唯一),退回後再送出改寫同一筆。
 *
 * 盤點送出不影響現金帳與庫存;核准完成時才套用(新增待查、確認遺失、尋回、未拆的本不在 → 待查),標記異常只做記號。
 * 補登售出、補登兌獎在盤點時已立即生效,這裡只記下來(`diffs[].eventId`)。
 * 沒盤完可以送出:送出時範圍內還沒盤的本記在 `uncountedBooks`(不比對、不記差異),之後可另開盤點補盤。
 */
@Schema({ collection: LOTTERY_STOCKTAKES_COLLECTION, timestamps: true })
export class LotteryStocktake {
  /** 分店。 */
  @Prop({ type: OBJECT_ID, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: String, enum: STOCKTAKE_TYPES, required: true })
  type!: StocktakeType;

  @Prop({ type: String, enum: STOCKTAKE_STATUSES, required: true })
  status!: StocktakeStatus;

  /** 只盤一個收銀點(單一收銀點的臨時盤點、交班);全店 = null。 */
  @Prop({ type: OBJECT_ID, default: null })
  scopeCashPointId!: Types.ObjectId | null;

  /** 開始盤的時間(畫面上記下)。 */
  @Prop({ type: Date, required: true })
  startedAt!: Date;

  @Prop({ type: OBJECT_ID, default: null })
  submittedBy!: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  submittedAt!: Date;

  /** 核准完成(已確認)的時間。 */
  @Prop({ type: Date, default: null })
  confirmedAt!: Date | null;

  /**
   * 退回 / 駁回的時間(重送時清成 null):營運報表「期末那一刻沒被駁回」用 —— 期末之後才駁回的,
   * 舊報表重跑照算(重跑不變;使用者 10/27 定案)。
   */
  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  /** 核准的人(最後核准的審核者;申請人是審核者自動通過時 = 申請人)。 */
  @Prop({ type: OBJECT_ID, default: null })
  confirmedBy!: Types.ObjectId | null;

  /** 盤點確認申請 / 結帳確認申請的提交 id(一張單據一筆)。 */
  @Prop({ type: OBJECT_ID, required: true })
  submissionId!: Types.ObjectId;

  @Prop({ type: [LINE_TYPE], default: [] })
  lines!: StocktakeLine[];

  @Prop({ type: [UNOPENED_TYPE], default: [] })
  unopenedLines!: StocktakeUnopenedLine[];

  @Prop({ type: [LOST_REVIEW_TYPE], default: [] })
  lostReviewLines!: StocktakeLostReviewLine[];

  /** 送出時範圍內還沒盤的本(不比對;沒盤完可以送出)。 */
  @Prop({ type: [UNCOUNTED_TYPE], default: [] })
  uncountedBooks!: StocktakeUncountedBook[];

  @Prop({ type: SUMMARY_TYPE, required: true })
  summary!: StocktakeSummary;

  /** 狀態改變的條件更新(送出 / 退回 / 駁回 / 完成各 +1)。 */
  @Prop({ type: Number, required: true, default: 0 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `store`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryStocktakeSchema =
  SchemaFactory.createForClass(LotteryStocktake);

LotteryStocktakeSchema.index({ submissionId: 1 }, { unique: true });
LotteryStocktakeSchema.index({ orgId: 1, submittedAt: -1 });
LotteryStocktakeSchema.plugin(baseFieldsPlugin);
// 資料共用 private(ADR-0014):總部看得到分店的盤點靠可見範圍「包含下層」
LotteryStocktakeSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryStocktakeSchema.path("moduleKey").default(STORE_KEY);
