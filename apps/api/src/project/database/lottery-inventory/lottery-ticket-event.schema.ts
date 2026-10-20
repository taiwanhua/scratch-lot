import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  TICKET_CASH_EFFECTS,
  TICKET_EVENT_TYPES,
  TICKET_LOCATION_KINDS,
  TICKET_STATUSES,
  type TicketCashEffect,
  type TicketEventType,
  type TicketLocationKind,
  type TicketStatus,
} from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { INVENTORY_MODULE_KEY } from "./inventory-module-key";

export const LOTTERY_TICKET_EVENTS_COLLECTION = "lottery_ticket_events";

/** 事件前後的張狀態快照(from / to)。 */
export interface TicketStateSnapshot {
  status: TicketStatus;
  locationKind: TicketLocationKind;
  cashPointId: Types.ObjectId | null;
  /** 所在分店。 */
  orgId: Types.ObjectId;
}

const SNAPSHOT_TYPE = {
  _id: false,
  status: { type: String, enum: TICKET_STATUSES, required: true },
  locationKind: { type: String, enum: TICKET_LOCATION_KINDS, required: true },
  cashPointId: { type: MongooseSchema.Types.ObjectId, default: null },
  orgId: { type: MongooseSchema.Types.ObjectId, required: true },
};

/**
 * 張數事件(專案規格 7.2;**只新增**,報表與盤點比對的唯一來源)。只由帳本服務
 * (`TicketLedgerService.applyTicketEvents`)與本的建立(進貨事件)寫入,和張的目前狀態在同一個交易。
 *
 * `orgId` = 事件發生後這張所在的分店(調出 = 出貨店、調入 = 收貨店);金額一律正數,方向看 `cashEffect`。
 */
@Schema({ collection: LOTTERY_TICKET_EVENTS_COLLECTION, timestamps: true })
export class LotteryTicketEvent {
  /** 分店(事件發生後這張所在的分店)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 事件 id = `<ticketId>:<變動後的版本>`;唯一,重送不重複寫入。 */
  @Prop({ type: String, required: true })
  eventId!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  ticketId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  gameId!: Types.ObjectId;

  /** 發生時間。 */
  @Prop({ type: Date, required: true })
  at!: Date;

  /** 誰(使用者 id;系統動作為 null)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  by!: Types.ObjectId | null;

  @Prop({ type: String, enum: TICKET_EVENT_TYPES, required: true })
  type!: TicketEventType;

  /** 變動前(進貨事件沒有前一個狀態 → null)。 */
  @Prop({ type: SNAPSHOT_TYPE, default: null })
  from!: TicketStateSnapshot | null;

  /** 變動後。 */
  @Prop({ type: SNAPSHOT_TYPE, required: true })
  to!: TicketStateSnapshot;

  /** 張數(一筆事件一張 = 1)。 */
  @Prop({ type: Number, default: 1 })
  quantity!: number;

  /** 金額:一律正數(0 = 不涉及金額)。 */
  @Prop({ type: Number, default: 0, min: 0 })
  amount!: number;

  /** 對應有現金的影響:不影響 / 增加 / 減少。 */
  @Prop({ type: String, enum: TICKET_CASH_EFFECTS, default: "none" })
  cashEffect!: TicketCashEffect;

  /** 錢算在哪個收銀點(售出、撤銷)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  cashPointId!: Types.ObjectId | null;

  /** 錢算在哪一班。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  shiftId!: Types.ObjectId | null;

  /** 來源單據類型(例:`purchase`、`transfer`、`stocktake`)。 */
  @Prop({ type: String, default: null })
  refType!: string | null;

  /** 來源單據 id。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  refId!: Types.ObjectId | null;

  /** 原因(欄位管理選項的值)。 */
  @Prop({ type: String, default: null })
  reasonKey!: string | null;

  /** 原因說明(選「其他」時)。 */
  @Prop({ type: String, default: null })
  reasonNote!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `inventory`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryTicketEventSchema =
  SchemaFactory.createForClass(LotteryTicketEvent);

LotteryTicketEventSchema.index({ eventId: 1 }, { unique: true });
LotteryTicketEventSchema.index({ orgId: 1, at: 1 });
LotteryTicketEventSchema.index({ cashPointId: 1, at: 1 });
LotteryTicketEventSchema.index({ ticketId: 1, at: 1 });
// 已給本數(進貨 + 調入 − 調出)依分店 × 遊戲彙總
LotteryTicketEventSchema.index({ orgId: 1, gameId: 1, type: 1 });
LotteryTicketEventSchema.plugin(baseFieldsPlugin);
LotteryTicketEventSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryTicketEventSchema.path("moduleKey").default(INVENTORY_MODULE_KEY);
