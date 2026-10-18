import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import {
  PRINTER_DEFAULT_PORT,
  PRINTER_PAPER_WIDTHS,
  PRINTER_STATUSES,
  type PrinterPaperWidth,
  type PrinterStatus,
} from "@repo/domain/printing";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import { tenantScopePlugin } from "../plugins/tenant-scope.plugin";
import { PRINTERS_MODULE_KEY } from "./print-agent.schema";

export const PRINTERS_COLLECTION = "printers";

/**
 * 收據機:**只記到分店層**,`orgId` = 連它的代理程式所在分店。
 * 專案要「收銀點的印表機」由專案自己加欄位。
 */
@Schema({ collection: PRINTERS_COLLECTION, timestamps: true })
export class Printer {
  /** 所在分店(= 代理程式的 `orgId`;建立時由代理程式帶入,不由呼叫端給)。 */
  @Prop({ type: Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 連這台印表機的代理程式。 */
  @Prop({ type: Types.ObjectId, required: true })
  agentId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  name!: string;

  /** 區域網路 IP 或主機名(收據機設固定 IP)。 */
  @Prop({ type: String, required: true })
  host!: string;

  /** TCP 埠(預設 9100)。 */
  @Prop({ type: Number, default: PRINTER_DEFAULT_PORT })
  port!: number;

  /** 紙寬 mm(底座只有 58)。 */
  @Prop({ type: Number, enum: PRINTER_PAPER_WIDTHS, default: 58 })
  paperWidth!: PrinterPaperWidth;

  /** 分店預設印表機(同一分店至多一台;設定新的預設時舊的改 false)。 */
  @Prop({ type: Boolean, default: false })
  isDefault!: boolean;

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 代理程式最後回報的狀態(正常 / 缺紙 / 離線);沒回報過為 null。 */
  @Prop({ type: String, enum: [...PRINTER_STATUSES, null], default: null })
  status!: PrinterStatus | null;

  /** `status` 的回報時間。 */
  @Prop({ type: Date, default: null })
  statusAt!: Date | null;

  /** 模組 key(固定 `PRINTERS_MODULE_KEY`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(`BaseRepository.create` 推導)。 */
  tenantId!: Types.ObjectId | null;
}

export const PrinterSchema = SchemaFactory.createForClass(Printer);

PrinterSchema.index({ orgId: 1, enabled: 1 });
PrinterSchema.index({ agentId: 1 });
PrinterSchema.plugin(baseFieldsPlugin);
PrinterSchema.plugin(tenantScopePlugin, { moduleData: true });
PrinterSchema.path("moduleKey").default(PRINTERS_MODULE_KEY);
