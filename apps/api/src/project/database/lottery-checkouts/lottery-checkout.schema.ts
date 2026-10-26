import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  CHECKOUT_STATUSES,
  CHECKOUT_STOCKTAKE_MODES,
  CHECKOUT_TYPES,
  type CheckoutStatus,
  type CheckoutStocktakeMode,
  type CheckoutType,
  EXPECTED_CASH_ITEM_KINDS,
  type ExpectedCashItemKind,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_CHECKOUTS_COLLECTION = "lottery_checkouts";

/** 應有現金一項裡的一筆紀錄(可點回單據:兌獎紀錄、現金流水、撤銷售出申請 / 現金更正單)。 */
export interface CheckoutCashEntry {
  /** 紀錄種類:`redemption` 兌獎紀錄 / `movement` 現金流水 / `submission` 單據 */
  refType: "redemption" | "movement" | "submission";
  refId: Types.ObjectId;
  /** 顯示文字(張編號、單號…) */
  label: string;
  occurredAt: Date;
  /** 帶正負號 */
  amount: number;
}

/** 應有現金的一項(規格 6.9 公式的一項;金額帶正負號)。 */
export interface CheckoutCashItem {
  kind: ExpectedCashItemKind;
  /** 筆數 / 張數 */
  count: number;
  amount: number;
  entries: CheckoutCashEntry[];
}

export interface CheckoutDenominationRow {
  value: number;
  count: number;
}

/** 送出時審核中、會影響這一班現金的單據快照(規格 6.9「⚠ 審核中」)。 */
export interface CheckoutPendingImpact {
  submissionId: Types.ObjectId;
  formKey: string;
  serialNo: string | null;
  amount: number;
}

const OBJECT_ID = MongooseSchema.Types.ObjectId;

const ENTRY_TYPE = {
  _id: false,
  refType: {
    type: String,
    enum: ["redemption", "movement", "submission"],
    required: true,
  },
  refId: { type: OBJECT_ID, required: true },
  label: { type: String, default: "" },
  occurredAt: { type: Date, required: true },
  amount: { type: Number, required: true },
};

const ITEM_TYPE = {
  _id: false,
  kind: { type: String, enum: EXPECTED_CASH_ITEM_KINDS, required: true },
  count: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  entries: { type: [ENTRY_TYPE], default: [] },
};

const DENOMINATION_TYPE = {
  _id: false,
  value: { type: Number, required: true },
  count: { type: Number, required: true },
};

const PENDING_TYPE = {
  _id: false,
  submissionId: { type: OBJECT_ID, required: true },
  formKey: { type: String, required: true },
  serialNo: { type: String, default: null },
  amount: { type: Number, required: true },
};

/**
 * 結帳單(專案規格 6.9、8.7;正本 `docs/modules/project/store.md`「交班結帳」)。交班精靈 [送出] 時由
 * 結帳確認申請的掛接點在同一個交易建立(一張申請一筆,`submissionId` 唯一;退回後再送出改寫同一筆);
 * 應有現金的各項在送出那一刻從紀錄加總並快照(之後的事後更正不改它)。
 * **日結**(`type = daily`,規格 6.10):沒有收銀點與班次;應有 / 實點 / 差額 / 面額 / 差額原因 / 應有各項記的是
 * **小金庫**;另有涵蓋計算期間、涵蓋的班、存入銀行(完成時才寫銀行「存入」與「存銀行」流水)。
 */
@Schema({ collection: LOTTERY_CHECKOUTS_COLLECTION, timestamps: true })
export class LotteryCheckout {
  /** 分店。 */
  @Prop({ type: OBJECT_ID, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: String, enum: CHECKOUT_TYPES, required: true })
  type!: CheckoutType;

  @Prop({ type: String, enum: CHECKOUT_STATUSES, required: true })
  status!: CheckoutStatus;

  /** 收銀點與班次(交班才有)。 */
  @Prop({ type: OBJECT_ID, default: null })
  cashPointId!: Types.ObjectId | null;

  @Prop({ type: OBJECT_ID, default: null })
  shiftId!: Types.ObjectId | null;

  /** 盤點方式:沿用 / 現在盤點 / 跳過。 */
  @Prop({ type: String, enum: CHECKOUT_STOCKTAKE_MODES, required: true })
  stocktakeMode!: CheckoutStocktakeMode;

  /** 盤點單(沿用的那一筆,或這張申請自己建立的);跳過 = null。 */
  @Prop({ type: OBJECT_ID, default: null })
  stocktakeId!: Types.ObjectId | null;

  /** 跳過盤點的原因(欄位管理「跳過盤點原因」代碼、名稱快照、說明);報表永久標示「未盤點」。 */
  @Prop({ type: String, default: null })
  skipReasonKey!: string | null;

  @Prop({ type: String, default: null })
  skipReason!: string | null;

  @Prop({ type: String, default: null })
  skipReasonNote!: string | null;

  /** 應有現金的各項明細(送出那一刻的快照)。 */
  @Prop({ type: [ITEM_TYPE], default: [] })
  expectedItems!: CheckoutCashItem[];

  @Prop({ type: Number, required: true })
  expected!: number;

  /** 實點(依面額清點)。 */
  @Prop({ type: [DENOMINATION_TYPE], default: [] })
  denominations!: CheckoutDenominationRow[];

  @Prop({ type: Number, required: true })
  counted!: number;

  /** 差額 = 實點 − 應有。 */
  @Prop({ type: Number, required: true })
  difference!: number;

  /** 差額原因(欄位管理「結帳差額原因」代碼、名稱快照、說明);差額 0 = null。 */
  @Prop({ type: String, default: null })
  diffReasonKey!: string | null;

  @Prop({ type: String, default: null })
  diffReason!: string | null;

  @Prop({ type: String, default: null })
  diffReasonNote!: string | null;

  /** 送出時審核中、會影響這一班現金的單據快照。 */
  @Prop({ type: [PENDING_TYPE], default: [] })
  pendingImpacts!: CheckoutPendingImpact[];

  /** 留給下一班(下一班的期初)。 */
  @Prop({ type: Number, required: true, default: 0 })
  leftForNext!: number;

  /** 接班人;沒有 = null(改由店長審核)。 */
  @Prop({ type: OBJECT_ID, default: null })
  successorId!: Types.ObjectId | null;

  @Prop({ type: OBJECT_ID, default: null })
  submittedBy!: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  submittedAt!: Date;

  /** 核准完成(已確認)的時間與人。 */
  @Prop({ type: Date, default: null })
  confirmedAt!: Date | null;

  @Prop({ type: OBJECT_ID, default: null })
  confirmedBy!: Types.ObjectId | null;

  /**
   * 最近一次退回 / 撤回的時間(重送時清成 null)。報表「期末那一刻有效的結帳單」用:
   * 期末時已退回、還沒重送的不算(`status = returned` 且 `returnedAt` 早於期末)。
   */
  @Prop({ type: Date, default: null })
  returnedAt!: Date | null;

  /** 日結:涵蓋計算期間(上一次日結送出 至 這次送出;第一次日結 `coveredFrom = null`)。交班 = null。 */
  @Prop({ type: Date, default: null })
  coveredFrom!: Date | null;

  @Prop({ type: Date, default: null })
  coveredTo!: Date | null;

  /** 日結:涵蓋計算的班(送出那一刻;交班結帳送出時間落在涵蓋計算期間的班)。 */
  @Prop({ type: [OBJECT_ID], default: [] })
  coveredShiftIds!: Types.ObjectId[];

  /** 日結:存入銀行的金額(0 = 不存)與帳戶。 */
  @Prop({ type: Number, default: 0 })
  bankDepositAmount!: number;

  @Prop({ type: OBJECT_ID, default: null })
  bankAccountId!: Types.ObjectId | null;

  /** 日結完成時寫的銀行「存入」與「存銀行」流水(沒存 = null)。 */
  @Prop({ type: OBJECT_ID, default: null })
  bankTransactionId!: Types.ObjectId | null;

  @Prop({ type: OBJECT_ID, default: null })
  bankMovementId!: Types.ObjectId | null;

  /** 結帳確認申請的提交 id(一張申請一筆)。 */
  @Prop({ type: OBJECT_ID, required: true })
  submissionId!: Types.ObjectId;

  /** 狀態改變的條件更新(送出 / 退回 / 完成各 +1)。 */
  @Prop({ type: Number, required: true, default: 0 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `store`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryCheckoutSchema =
  SchemaFactory.createForClass(LotteryCheckout);

LotteryCheckoutSchema.index({ submissionId: 1 }, { unique: true });
LotteryCheckoutSchema.index({ orgId: 1, submittedAt: -1 });
LotteryCheckoutSchema.index({ shiftId: 1, submittedAt: -1 });
// 日結:這家店最近一張日結(涵蓋計算期間的起點、小金庫起算點、第一班的判斷)
LotteryCheckoutSchema.index({ orgId: 1, type: 1, coveredTo: -1 });
LotteryCheckoutSchema.plugin(baseFieldsPlugin);
// 資料共用 private(ADR-0014):總部看得到分店的結帳靠可見範圍「包含下層」
LotteryCheckoutSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryCheckoutSchema.path("moduleKey").default(STORE_KEY);
