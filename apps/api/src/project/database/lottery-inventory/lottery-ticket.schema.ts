import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  TICKET_LOCATION_KINDS,
  TICKET_LOCK_REF_TYPES,
  TICKET_SOLD_SOURCES,
  TICKET_STATUSES,
  type TicketLocationKind,
  type TicketLockRefType,
  type TicketSoldSource,
  type TicketStatus,
} from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import {
  type ShareOrg,
  tenantScopePlugin,
} from "../../../database/plugins/tenant-scope.plugin";
import { INVENTORY_MODULE_KEY } from "./inventory-module-key";

export const LOTTERY_TICKETS_COLLECTION = "lottery_tickets";

/** 張的位置:庫存 / 檯面(`cashPointId` = 哪個收銀點)/ 在途。 */
export interface TicketLocation {
  kind: TicketLocationKind;
  cashPointId: Types.ObjectId | null;
}

/** 鎖定:調貨單(「調貨中」)或撤銷售出申請;鎖定時不能賣。 */
export interface TicketLock {
  refType: TicketLockRefType;
  refId: Types.ObjectId;
}

/**
 * 張(專案規格 7.1;正本 `docs/modules/project/inventory.md`「資料與帳本」)。
 * 狀態、位置、鎖定三個欄位各表達一件事;**只經帳本服務改**(`TicketLedgerService`),
 * 每次變動以「狀態 + `version`」條件更新,`version` +1,並在同一個交易寫一筆張數事件。
 *
 * `orgId` 是歸屬(租戶頂層,建立後不變);規格的「目前所在分店」是 `storeOrgId`(零碎調貨只改被調的張),
 * 分店看得到這張靠資料共用的 `sharedByFields`。
 */
@Schema({ collection: LOTTERY_TICKETS_COLLECTION, timestamps: true })
export class LotteryTicket {
  /** 歸屬:租戶頂層;建立後不變。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  gameId!: Types.ObjectId;

  /** 本號 7 位(快照,查詢用)。 */
  @Prop({ type: String, required: true })
  bookNo!: string;

  /** 張號 3 碼字串。 */
  @Prop({ type: String, required: true })
  ticketNo!: string;

  /** 張編號 `5164-0056527-001`,租戶內唯一。 */
  @Prop({ type: String, required: true })
  ticketKey!: string;

  /** 目前所在分店。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  storeOrgId!: Types.ObjectId;

  /** 狀態:未售 / 已售 / 跳號 / 報廢 / 待查 / 遺失。 */
  @Prop({ type: String, enum: TICKET_STATUSES, required: true })
  status!: TicketStatus;

  /** 位置:`{ kind, cashPointId }`。 */
  @Prop({
    type: {
      _id: false,
      kind: { type: String, enum: TICKET_LOCATION_KINDS, required: true },
      cashPointId: { type: MongooseSchema.Types.ObjectId, default: null },
    },
    required: true,
  })
  location!: TicketLocation;

  /** 鎖定:調貨單或撤銷售出申請;null = 沒有鎖定。 */
  @Prop({
    type: {
      _id: false,
      refType: { type: String, enum: TICKET_LOCK_REF_TYPES, required: true },
      refId: { type: MongooseSchema.Types.ObjectId, required: true },
    },
    default: null,
  })
  lockedBy!: TicketLock | null;

  /** 責任分店:待查或遺失時填。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  responsibleOrgId!: Types.ObjectId | null;

  /** 單張成本:點收時 = 本的成本 ÷ 標準張數;調入時 = 調貨單那一列的批購金額 ÷ 張數。不四捨五入(報表加總)。 */
  @Prop({ type: Number, required: true })
  unitCost!: number;

  /** 最近一次售出:時間。 */
  @Prop({ type: Date, default: null })
  soldAt!: Date | null;

  /** 最近一次售出:誰。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  soldBy!: Types.ObjectId | null;

  /** 最近一次售出:刷條碼 / 手動 / 盤點補登。 */
  @Prop({ type: String, enum: [...TICKET_SOLD_SOURCES, null], default: null })
  soldSource!: TicketSoldSource | null;

  /** 樂觀鎖:每次變動 +1;張數事件 id = `<ticketId>:<變動後的版本>`。 */
  @Prop({ type: Number, required: true, default: 1 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `inventory`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;

  /** 共用清單(plugin 宣告;本表固定空清單)。 */
  shareOrgs!: ShareOrg[];
}

export const LotteryTicketSchema = SchemaFactory.createForClass(LotteryTicket);

LotteryTicketSchema.index({ bookId: 1, ticketNo: 1 }, { unique: true });
LotteryTicketSchema.index({ storeOrgId: 1, bookNo: 1, ticketNo: 1 });
LotteryTicketSchema.index({ storeOrgId: 1, "location.kind": 1, status: 1 });
LotteryTicketSchema.index(
  { tenantId: 1, ticketKey: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
// 資料共用的 sharedByFields 要有 { tenantId, <欄位> } 開頭的索引
LotteryTicketSchema.index({ tenantId: 1, storeOrgId: 1 });
LotteryTicketSchema.plugin(baseFieldsPlugin);
LotteryTicketSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: {
    mode: "shareable",
    defaultShareOrgs: "none",
    editable: false,
    sharedByFields: [{ path: "storeOrgId", includeDescendants: false }],
  },
});
LotteryTicketSchema.path("moduleKey").default(INVENTORY_MODULE_KEY);
