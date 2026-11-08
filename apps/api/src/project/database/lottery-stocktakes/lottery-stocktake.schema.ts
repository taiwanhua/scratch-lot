import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  RESCAN_OUTCOMES,
  type RescanOutcome,
  STOCKTAKE_COUNT_MODES,
  STOCKTAKE_DIFF_ACTIONS,
  STOCKTAKE_DIFF_KINDS,
  STOCKTAKE_LOST_ACTIONS,
  STOCKTAKE_METHODS,
  STOCKTAKE_PURPOSES,
  STOCKTAKE_STATUSES,
  STOCKTAKE_TYPES,
  STORE_KEY,
  type StocktakeCountMode,
  type StocktakeDiffAction,
  type StocktakeDiffKind,
  type StocktakeLostAction,
  type StocktakeMethod,
  type StocktakePurpose,
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

/** 一本 × 收銀點(`cashPointId: null` = 拆過、在庫存的張那一區)。 */
export interface StocktakeLine {
  bookId: Types.ObjectId;
  gameCode: string;
  gameName: string;
  bookNo: string;
  cashPointId: Types.ObjectId | null;
  countedAt: Date;
  method: StocktakeMethod;
  /** 盤到那一刻的系統數字(這個收銀點檯面上未售的張數)。 */
  systemCount: number;
  /** 實盤(點到 / 刷到的張數)。 */
  presentTicketNos: string[];
  diffs: StocktakeDiffRow[];
}

/**
 * 張數盤點的一組「遊戲 × 收銀點」(張數店規格 5.4 `countLines[]`、8.1、8.2、13.1)。
 * `diffs[]` 共用 `DIFF_TYPE`:[算售出] 送出時記挑到的每一張(立即生效的那幾筆);[待查] 核准時才挑張,
 * 挑到的每一張在核准時加進來。
 */
export interface StocktakeCountLine {
  gameId: Types.ObjectId;
  gameCode: string;
  gameName: string;
  cashPointId: Types.ObjectId;
  countedAt: Date;
  /** 開始數那一刻這個收銀點這個遊戲的未售張數。 */
  systemCount: number;
  /** 實際剩幾張(最後一次輸入)。 */
  presentCount: number;
  /** 之前的每次輸入([重數] 前的數字;店長看得到「第一次數 11、改成 12」)。 */
  recounts: number[];
  /** [算售出] 的張數。 */
  saleCount: number;
  /** [算售出] 寫的售出事件的 `refId`(退回後再送出時核對是自己算售出的)。 */
  saleRefIds: Types.ObjectId[];
  /** [待查] 的張數(核准時照挑張順序挑張記待查·未對號)。 */
  investigateCount: number;
  /** 多出 [標記異常] 的張數(只做記號)。 */
  flaggedCount: number;
  diffs: StocktakeDiffRow[];
}

/** 送出時盤點範圍內還沒數的組(張數盤點;比照 `uncountedBooks[]`)。 */
export interface StocktakeUncountedGroup {
  gameId: Types.ObjectId;
  gameCode: string;
  gameName: string;
  cashPointId: Types.ObjectId;
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
  /** null = 拆過、在庫存的張那一區。 */
  cashPointId: Types.ObjectId | null;
}

export interface StocktakeSummary {
  books: number;
  backfillCount: number;
  backfillAmount: number;
  newInvestigate: number;
  flagged: number;
  confirmLost: number;
  confirmLostCost: number;
  /** 送出時還沒盤的本數(`uncountedBooks.length`,張數盤點另加還沒數的組 `uncountedGroups.length`;報表讀這裡)。 */
  uncountedCount: number;
  /** 補點編號自動對號的組數(不算差異;日結確認「補點編號 · 對號 3 張」)。舊資料沒有 = 0。 */
  renumberMatched?: number;
}

/** 全店重刷的一個位置(`cashPointId: null` = 庫存;張數店規格 5.4 `rescan`、8.4)。 */
export interface StocktakeRescanPlace {
  cashPointId: Types.ObjectId | null;
  /** 刷到的張(依刷的順序;每刷一張就存,重新整理不會不見、換裝置可接著刷) */
  scannedTicketIds: Types.ObjectId[];
  /** 刷到一半的人(1 小時沒刷就釋出、清單保留) */
  scanningBy: Types.ObjectId | null;
  lastScanAt: Date | null;
  doneAt: Date | null;
  doneBy: Types.ObjectId | null;
}

/** 全店重刷的一筆結果(按「這裡刷完了」時寫;`ok` 不記)。 */
export interface StocktakeRescanResult {
  cashPointId: Types.ObjectId | null;
  ticketId: Types.ObjectId;
  /** `investigated` = 系統記在這裡、沒刷到 → 待查;其餘同 `RescanOutcome` */
  outcome: RescanOutcome | "investigated";
  /** `matched`:互換的配對張 */
  partnerTicketId: Types.ObjectId | null;
}

/** 全店重刷(只有 `purpose: rescan`;張數店規格 5.4、8.4)。 */
export interface StocktakeRescan {
  gameId: Types.ObjectId;
  gameCode: string;
  gameName: string;
  /** 開始重刷的人([取消重刷] = 他或店長) */
  startedBy: Types.ObjectId;
  /** 最後一次有位置刷到或按刷完(1 小時沒動作 → 自動取消) */
  lastActiveAt: Date;
  finishedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  /** `manual` = [取消重刷];`expired` = 1 小時沒動作自動取消 */
  cancelCause: "manual" | "expired" | null;
  places: StocktakeRescanPlace[];
  results: StocktakeRescanResult[];
}

const OBJECT_ID = MongooseSchema.Types.ObjectId;

const RESCAN_TYPE = {
  _id: false,
  gameId: { type: OBJECT_ID, required: true },
  gameCode: { type: String, default: "" },
  gameName: { type: String, default: "" },
  startedBy: { type: OBJECT_ID, required: true },
  lastActiveAt: { type: Date, required: true },
  finishedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: OBJECT_ID, default: null },
  cancelCause: {
    type: String,
    enum: ["manual", "expired", null],
    default: null,
  },
  places: {
    type: [
      {
        _id: false,
        cashPointId: { type: OBJECT_ID, default: null },
        scannedTicketIds: { type: [OBJECT_ID], default: [] },
        scanningBy: { type: OBJECT_ID, default: null },
        lastScanAt: { type: Date, default: null },
        doneAt: { type: Date, default: null },
        doneBy: { type: OBJECT_ID, default: null },
      },
    ],
    default: [],
  },
  results: {
    type: [
      {
        _id: false,
        cashPointId: { type: OBJECT_ID, default: null },
        ticketId: { type: OBJECT_ID, required: true },
        outcome: {
          type: String,
          enum: [...RESCAN_OUTCOMES, "investigated"],
          required: true,
        },
        partnerTicketId: { type: OBJECT_ID, default: null },
      },
    ],
    default: [],
  },
};

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
  cashPointId: { type: OBJECT_ID, default: null },
  countedAt: { type: Date, required: true },
  method: { type: String, enum: STOCKTAKE_METHODS, required: true },
  systemCount: { type: Number, default: 0 },
  presentTicketNos: { type: [String], default: [] },
  diffs: { type: [DIFF_TYPE], default: [] },
};

const COUNT_LINE_TYPE = {
  _id: false,
  gameId: { type: OBJECT_ID, required: true },
  gameCode: { type: String, required: true },
  gameName: { type: String, default: "" },
  cashPointId: { type: OBJECT_ID, required: true },
  countedAt: { type: Date, required: true },
  systemCount: { type: Number, default: 0 },
  presentCount: { type: Number, default: 0 },
  recounts: { type: [Number], default: [] },
  saleCount: { type: Number, default: 0 },
  saleRefIds: { type: [OBJECT_ID], default: [] },
  investigateCount: { type: Number, default: 0 },
  flaggedCount: { type: Number, default: 0 },
  diffs: { type: [DIFF_TYPE], default: [] },
};

const UNCOUNTED_GROUP_TYPE = {
  _id: false,
  gameId: { type: OBJECT_ID, required: true },
  gameCode: { type: String, required: true },
  gameName: { type: String, default: "" },
  cashPointId: { type: OBJECT_ID, required: true },
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
  cashPointId: { type: OBJECT_ID, default: null },
};

/**
 * 補點編號的一組自動對號(張數店規格 9.3 第 2 點):實際在、系統是未對號的張 ↔ 實際不在、系統未售的張
 * (同遊戲、同位置;送出時比對算出,核准時才寫 `match`)。
 */
export interface StocktakeRenumberMatch {
  ticketId: Types.ObjectId;
  ticketNo: string;
  bookNo: string;
  partnerId: Types.ObjectId;
  partnerTicketNo: string;
  partnerBookNo: string;
  gameCode: string;
  gameName: string;
  /** 位置(收銀點;庫存 = null) */
  cashPointId: Types.ObjectId | null;
  /** 那一本開始盤的時間(核准時之後有異動的不寫) */
  countedAt: Date;
}

/**
 * 補點編號的比對結果(只有 `purpose: renumber`;其他 = null):自動對號、實際在但沒有配對張的待查 / 遺失·未對號
 * (核准時尋回留在盤到的位置,6.4)。
 */
export interface StocktakeRenumber {
  matches: StocktakeRenumberMatch[];
  recovered: {
    ticketId: Types.ObjectId;
    cashPointId: Types.ObjectId | null;
    countedAt: Date;
  }[];
}

const RENUMBER_TYPE = {
  _id: false,
  matches: {
    type: [
      {
        _id: false,
        ticketId: { type: OBJECT_ID, required: true },
        ticketNo: { type: String, required: true },
        bookNo: { type: String, default: "" },
        partnerId: { type: OBJECT_ID, required: true },
        partnerTicketNo: { type: String, required: true },
        partnerBookNo: { type: String, default: "" },
        gameCode: { type: String, default: "" },
        gameName: { type: String, default: "" },
        cashPointId: { type: OBJECT_ID, default: null },
        countedAt: { type: Date, required: true },
      },
    ],
    default: [],
  },
  recovered: {
    type: [
      {
        _id: false,
        ticketId: { type: OBJECT_ID, required: true },
        cashPointId: { type: OBJECT_ID, default: null },
        countedAt: { type: Date, required: true },
      },
    ],
    default: [],
  },
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
  renumberMatched: { type: Number, default: 0 },
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

  /** 第一次送出的時間(退回後再送出不改寫;營運報表依它判斷屬於哪段期間)。 */
  @Prop({ type: Date, default: null })
  firstSubmittedAt!: Date | null;

  /**
   * 每一次送出的快照(依時間;最後一筆 = 現在這一次):送出時間、這一次被退回 / 駁回的時間、未盤本數。
   * 營運報表依「期末那一刻有效的那一次」算(重跑舊報表數字不變)。
   */
  @Prop({
    type: [
      {
        _id: false,
        submittedAt: { type: Date, required: true },
        closedAt: { type: Date, default: null },
        uncountedCount: { type: Number, default: 0 },
      },
    ],
    default: [],
  })
  attempts!: {
    submittedAt: Date;
    closedAt: Date | null;
    uncountedCount: number;
  }[];

  /** 核准的人(最後核准的審核者;申請人是審核者自動通過時 = 申請人)。 */
  @Prop({ type: OBJECT_ID, default: null })
  confirmedBy!: Types.ObjectId | null;

  /** 盤點確認申請 / 結帳確認申請的提交 id(一張單據一筆)。 */
  @Prop({ type: OBJECT_ID, required: true })
  submissionId!: Types.ObjectId;

  /** 盤點制度(張數店規格 5.4;送出時定;舊資料沒有 = 編號盤點)。 */
  @Prop({ type: String, enum: STOCKTAKE_COUNT_MODES, default: "numbered" })
  countMode!: StocktakeCountMode;

  /** 用途:一般 / 補點編號 / 全店重刷(交班 / 日結 / 臨時是入口 `type`)。 */
  @Prop({ type: String, enum: STOCKTAKE_PURPOSES, default: "normal" })
  purpose!: StocktakePurpose;

  @Prop({ type: [LINE_TYPE], default: [] })
  lines!: StocktakeLine[];

  /** 張數盤點的「遊戲 × 收銀點」(編號盤點 = 空;庫存照舊在 `lines` 逐張)。 */
  @Prop({ type: [COUNT_LINE_TYPE], default: [] })
  countLines!: StocktakeCountLine[];

  @Prop({ type: [UNOPENED_TYPE], default: [] })
  unopenedLines!: StocktakeUnopenedLine[];

  @Prop({ type: [LOST_REVIEW_TYPE], default: [] })
  lostReviewLines!: StocktakeLostReviewLine[];

  /** 送出時範圍內還沒盤的本(不比對;沒盤完可以送出)。 */
  @Prop({ type: [UNCOUNTED_TYPE], default: [] })
  uncountedBooks!: StocktakeUncountedBook[];

  /** 張數盤點送出時範圍內還沒數的組(`summary.uncountedCount` 含這些組)。 */
  @Prop({ type: [UNCOUNTED_GROUP_TYPE], default: [] })
  uncountedGroups!: StocktakeUncountedGroup[];

  /**
   * 全店重刷(只有 `purpose: rescan`;其他 = null)。重刷單不需核准:進行中 = `pending`、全部位置刷完 = `confirmed`、
   * 取消(含自動取消)= `rejected`(`closedAt`);`type` 記 `adhoc`(入口是看板的提醒,不是交班 / 日結)。
   */
  @Prop({ type: RESCAN_TYPE, default: null })
  rescan!: StocktakeRescan | null;

  /** 補點編號的比對結果(只有 `purpose: renumber`;其他 = null)。 */
  @Prop({ type: RENUMBER_TYPE, default: null })
  renumber!: StocktakeRenumber | null;

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
// 進行中的全店重刷、各遊戲上次重刷完成(看板提醒;partial:只有重刷單)
LotteryStocktakeSchema.index(
  { orgId: 1, "rescan.gameId": 1, status: 1 },
  { partialFilterExpression: { purpose: "rescan" } },
);
LotteryStocktakeSchema.plugin(baseFieldsPlugin);
// 資料共用 private(ADR-0014):總部看得到分店的盤點靠可見範圍「包含下層」
LotteryStocktakeSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryStocktakeSchema.path("moduleKey").default(STORE_KEY);
