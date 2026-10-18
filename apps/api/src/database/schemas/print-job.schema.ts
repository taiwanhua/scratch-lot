import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import {
  PRINT_JOB_ERRORS,
  PRINT_JOB_STATUSES,
  type PrintJobError,
  type PrintJobStatus,
} from "@repo/domain/printing";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import { tenantScopePlugin } from "../plugins/tenant-scope.plugin";
import { PRINTERS_MODULE_KEY } from "./print-agent.schema";

export const PRINT_JOBS_COLLECTION = "print_jobs";

/**
 * 列印工作:瀏覽器把單據轉成 384 點寬的黑白 PNG 送來,
 * 代理程式認領(等待中 → 已送出)後拿圖片列印,再回報已印 / 失敗。
 *
 * 補印:`isReprint = true` 時 `reprintReason` 存欄位管理類別「補印原因」的選項值,
 * 選「其他」時 `reprintNote` 必填;`isReprint = false` 時兩欄都是 null。
 */
@Schema({ collection: PRINT_JOBS_COLLECTION, timestamps: true })
export class PrintJob {
  /** 印表機所在分店。 */
  @Prop({ type: Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  printerId!: Types.ObjectId;

  /** 建立當下負責的代理程式(印表機的 `agentId` 快照;信號送給它)。 */
  @Prop({ type: Types.ObjectId, required: true })
  agentId!: Types.ObjectId;

  /** 單據類型(由使用的模組決定,如 `order-receipt`;測試頁是 `printer-test-page`)。 */
  @Prop({ type: String, required: true })
  documentType!: string;

  /** 單據的關聯類型與 id(同一張單據的列印次數依這兩欄計算)。 */
  @Prop({ type: String, required: true })
  refType!: string;

  @Prop({ type: String, required: true })
  refId!: string;

  /** 單據的顯示名稱(通知用,如「訂單 A001 收據」);沒給為 null,通知改用「單據類型 + 編號」。 */
  @Prop({ type: String, default: null })
  documentName!: string | null;

  /** 內容快照:384 點寬的黑白 PNG(查詢時預設不帶,只有代理程式取圖時讀)。 */
  @Prop({ type: Buffer, required: true, select: false })
  image!: Buffer;

  @Prop({ type: String, enum: PRINT_JOB_STATUSES, required: true })
  status!: PrintJobStatus;

  /** 失敗原因(`@repo/domain/printing` 的 `PRINT_JOB_ERRORS`);沒失敗為 null。 */
  @Prop({ type: String, enum: [...PRINT_JOB_ERRORS, null], default: null })
  error!: PrintJobError | null;

  @Prop({ type: Boolean, default: false })
  isReprint!: boolean;

  /** 這張單據的第幾次列印(= 建立當下已印次數 + 1)。 */
  @Prop({ type: Number, required: true })
  printNo!: number;

  /** 補印原因(欄位選項值);非補印為 null。 */
  @Prop({ type: String, default: null })
  reprintReason!: string | null;

  /** 補印說明;非補印、或補印沒填為 null。 */
  @Prop({ type: String, default: null })
  reprintNote!: string | null;

  /** 要求人(按 [列印] 的使用者);`print-result` 送給他。 */
  @Prop({ type: Types.ObjectId, required: true })
  requestedBy!: Types.ObjectId;

  /** 代理程式認領的時間。 */
  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  /** 已印的時間。 */
  @Prop({ type: Date, default: null })
  printedAt!: Date | null;

  /** 模組 key(固定 `PRINTERS_MODULE_KEY`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(`BaseRepository.create` 推導):`print-result` / `print-job` 信號送到哪個租戶。 */
  tenantId!: Types.ObjectId | null;
}

export const PrintJobSchema = SchemaFactory.createForClass(PrintJob);

// 代理程式拿工作 / 逾時掃描:依印表機與狀態、時間
PrintJobSchema.index({ printerId: 1, status: 1, createdAt: 1 });
PrintJobSchema.index({ status: 1, createdAt: 1 });
// 同一張單據的列印次數
PrintJobSchema.index({ refType: 1, refId: 1, status: 1 });
// 列印紀錄分頁
PrintJobSchema.index({ orgId: 1, createdAt: -1 });
PrintJobSchema.plugin(baseFieldsPlugin);
PrintJobSchema.plugin(tenantScopePlugin, { moduleData: true });
PrintJobSchema.path("moduleKey").default(PRINTERS_MODULE_KEY);
