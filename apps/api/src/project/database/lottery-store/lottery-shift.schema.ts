import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { STORE_KEY } from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_SHIFTS_COLLECTION = "lottery_shifts";

/** 期初零用金的來源:第一班從小金庫領 / 第一班沒領 / 上一班留給下一班(規格 6.6)。 */
export const OPENING_FLOAT_SOURCES = ["vault", "none", "handover"] as const;
export type OpeningFloatSource = (typeof OPENING_FLOAT_SOURCES)[number];

/** 開班時寫入的任務快照(規格 14.9:職責 + 任務內容);改對應排班時重寫。 */
export interface ShiftTaskSnapshot {
  demandId: string;
  taskId: string;
  /** `leader` 負責人 / `helper` 協同 */
  role: string;
  taskKey: string;
  positionKey: string;
}

/** 崗位不一致的提醒紀錄:這筆排班沒有填進收銀點崗位的人力需求(只提醒,照樣開班)。 */
export interface ShiftPositionMismatch {
  /** 收銀點的崗位。 */
  cashPointPositionKey: string;
  /** 這筆排班填進的人力需求的崗位(沒有填進任何人力需求 = 空)。 */
  entryPositionKeys: string[];
}

const TASK_SNAPSHOT_TYPE = {
  _id: false,
  demandId: { type: String, required: true },
  taskId: { type: String, required: true },
  role: { type: String, required: true },
  taskKey: { type: String, required: true },
  positionKey: { type: String, required: true },
};

const POSITION_MISMATCH_TYPE = {
  _id: false,
  cashPointPositionKey: { type: String, required: true },
  entryPositionKeys: { type: [String], default: [] },
};

/**
 * 收銀班次(專案規格 6.6;正本 `docs/modules/project/store.md`「資料」)。開班的人就是負責人;
 * 一個人可以同時開同一家店多個收銀點的班,不能跨店。**同一個收銀點同時只能有一班開著**:
 * 部分唯一索引 `(cashPointId)`(`closedAt` 為 null)守同時開班。
 * 抽屜應有不存數字,一律由 `expectedDrawerCash` 從期初 + 張數事件 + 現金流水 + 登記的來源加總。
 */
@Schema({ collection: LOTTERY_SHIFTS_COLLECTION, timestamps: true })
export class LotteryShift {
  /** 分店(收銀點所在)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  cashPointId!: Types.ObjectId;

  /** 負責人(開班的人)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  openedBy!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  openedAt!: Date;

  /** 期初零用金(元,≥ 0)。 */
  @Prop({ type: Number, required: true, min: 0 })
  openingFloat!: number;

  /** 期初零用金的來源。 */
  @Prop({ type: String, enum: OPENING_FLOAT_SOURCES, required: true })
  openingFloatSource!: OpeningFloatSource;

  /** 上一班(期初來自「留給下一班」時;第一班 = null)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  previousShiftId!: Types.ObjectId | null;

  /** 開班時領零用金寫的出庫流水(第一班有領才有)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  openingMovementId!: Types.ObjectId | null;

  /** 對應排班;「沒有排班(臨時代班)」= null(畫面標「未對應排班」)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  scheduleEntryId!: Types.ObjectId | null;

  /** 任務快照;對不到或臨時代班 = null。 */
  @Prop({ type: TASK_SNAPSHOT_TYPE, default: null })
  scheduleTaskSnapshot!: ShiftTaskSnapshot | null;

  /** 崗位不一致的提醒紀錄;一致或臨時代班 = null。 */
  @Prop({ type: POSITION_MISMATCH_TYPE, default: null })
  positionMismatch!: ShiftPositionMismatch | null;

  /** 送出交班結帳的時間(這一班結束);開著 = null。 */
  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  /** 交班結帳單(送出時填)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  checkoutId!: Types.ObjectId | null;

  /**
   * 抽屜的版本:動到這一班抽屜的動作(投庫、出庫…)在同一個交易先 +1,讓兩個同時的動作互相衝突、
   * 由交易重試排隊(投庫不能超過抽屜應有)。
   */
  @Prop({ type: Number, required: true, default: 0 })
  drawerVersion!: number;

  /**
   * 顯示名稱 `店內櫃台 · 李小華 10/21 13:00`(開班時存;`shiftLabelOf`):lookup 來源 `lottery_shift` 的顯示欄
   * (撤銷售出申請的退款班次、現金更正單的位置 / 歸屬班次)。之前開的班沒有 = 空字串。
   */
  @Prop({ type: String, default: "" })
  label!: string;

  /** 模組 key(plugin 宣告;本表固定 `store`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryShiftSchema = SchemaFactory.createForClass(LotteryShift);

// 同一個收銀點同時只能有一班開著(兩人同時按 [開班] → 一個成功)
LotteryShiftSchema.index(
  { cashPointId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      closedAt: { $type: "null" },
      deletedAt: { $type: "null" },
    },
  },
);
LotteryShiftSchema.index({ orgId: 1, openedAt: -1 });
LotteryShiftSchema.index({ cashPointId: 1, openedAt: -1 });
LotteryShiftSchema.index({ tenantId: 1, openedBy: 1, closedAt: 1 });
LotteryShiftSchema.index({ tenantId: 1, scheduleEntryId: 1 });
LotteryShiftSchema.plugin(baseFieldsPlugin);
// 資料共用 private(ADR-0014):總部看得到分店的班靠可見範圍「包含下層」
LotteryShiftSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryShiftSchema.path("moduleKey").default(STORE_KEY);
