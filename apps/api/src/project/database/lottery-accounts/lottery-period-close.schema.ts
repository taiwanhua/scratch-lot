import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { ACCOUNTS_KEY } from "@repo/domain/project/lottery-accounts";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_PERIOD_CLOSES_COLLECTION = "lottery_period_closes";

const OBJECT_ID = MongooseSchema.Types.ObjectId;

/** 快照:一個帳戶的月底餘額(名稱為關帳當下的快照;之後改帳號不回頭改)。 */
export interface PeriodCloseBankAccountSnapshot {
  accountId: Types.ObjectId;
  label: string;
  balance: number;
}

/** 快照:一個收銀點月底抽屜裡的錢。 */
export interface PeriodCloseDrawerSnapshot {
  cashPointId: Types.ObjectId;
  name: string;
  /** 月底時抽屜的錢:月底前最後一班交班留給下一班的金額;月底有跨月的班 = null(那一班另記) */
  amount: number | null;
  /** 跨過月底的那一班的顯示名稱;沒有 = null */
  spanningShiftLabel: string | null;
}

/** 快照:沒有被日結涵蓋計算的一班。 */
export interface PeriodCloseShiftSnapshot {
  shiftId: Types.ObjectId;
  label: string;
}

/** 快照:一家分店。 */
export interface PeriodCloseStoreSnapshot {
  orgId: Types.ObjectId;
  name: string;
  /** 月底小金庫應有 */
  vault: number;
  drawers: PeriodCloseDrawerSnapshot[];
  /** 那個月沒有被日結涵蓋計算的班(只警告) */
  uncoveredShifts: PeriodCloseShiftSnapshot[];
}

export interface PeriodCloseSnapshot {
  bankAccounts: PeriodCloseBankAccountSnapshot[];
  stores: PeriodCloseStoreSnapshot[];
}

const SNAPSHOT_TYPE = {
  _id: false,
  bankAccounts: {
    type: [
      {
        _id: false,
        accountId: { type: OBJECT_ID, required: true },
        label: { type: String, default: "" },
        balance: { type: Number, required: true },
      },
    ],
    default: [],
  },
  stores: {
    type: [
      {
        _id: false,
        orgId: { type: OBJECT_ID, required: true },
        name: { type: String, default: "" },
        vault: { type: Number, required: true },
        drawers: {
          type: [
            {
              _id: false,
              cashPointId: { type: OBJECT_ID, required: true },
              name: { type: String, default: "" },
              amount: { type: Number, default: null },
              spanningShiftLabel: { type: String, default: null },
            },
          ],
          default: [],
        },
        uncoveredShifts: {
          type: [
            {
              _id: false,
              shiftId: { type: OBJECT_ID, required: true },
              label: { type: String, default: "" },
            },
          ],
          default: [],
        },
      },
    ],
    default: [],
  },
};

/**
 * 關帳(專案規格 10.4;正本 `docs/modules/project/accounts.md`「關帳」)。一個租戶一個月一筆
 * (唯一 `(tenantId, month)`;兩人同時關同一個月由索引擋下後到的)。範圍是**整個租戶**,
 * `orgId` = 租戶頂層;只新增,**不能重新開帳**(沒有修改 / 刪除端點)。
 * `periodEnd` = 下月 1 日 00:00(租戶時區;不含):時點 < 最後一筆已關帳月份的 `periodEnd` = 已關帳。
 */
@Schema({ collection: LOTTERY_PERIOD_CLOSES_COLLECTION, timestamps: true })
export class LotteryPeriodClose {
  /** 租戶頂層(範圍是整個租戶)。 */
  @Prop({ type: OBJECT_ID, required: true })
  orgId!: Types.ObjectId;

  /** 月份 `YYYY-MM`。 */
  @Prop({ type: String, required: true })
  month!: string;

  /** 期間(租戶時區 1 日 00:00 至 下月 1 日 00:00,不含)。 */
  @Prop({ type: Date, required: true })
  periodStart!: Date;

  @Prop({ type: Date, required: true })
  periodEnd!: Date;

  @Prop({ type: Date, required: true })
  closedAt!: Date;

  @Prop({ type: OBJECT_ID, required: true })
  closedBy!: Types.ObjectId;

  /** 備註(選填)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 關帳當下的快照:每個帳戶月底餘額、每家分店的小金庫 / 抽屜 / 沒被日結涵蓋計算的班。 */
  @Prop({ type: SNAPSHOT_TYPE, required: true })
  snapshot!: PeriodCloseSnapshot;

  /** 模組 key(plugin 宣告;本表固定 `accounts`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryPeriodCloseSchema =
  SchemaFactory.createForClass(LotteryPeriodClose);

// 一個租戶一個月一筆(重關 → 唯一索引擋下)
LotteryPeriodCloseSchema.index({ tenantId: 1, month: 1 }, { unique: true });
// 最後一個已關帳月份(`assertPeriodOpen`)
LotteryPeriodCloseSchema.index({ tenantId: 1, periodEnd: -1 });
LotteryPeriodCloseSchema.plugin(baseFieldsPlugin);
// 資料共用 private(ADR-0014):歸屬是租戶頂層,總部(含下層)看得到;分店讀「已關帳到哪」經 `PeriodLock`(租戶邊界)
LotteryPeriodCloseSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryPeriodCloseSchema.path("moduleKey").default(ACCOUNTS_KEY);
