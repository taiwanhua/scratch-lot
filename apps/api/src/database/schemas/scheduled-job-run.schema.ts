import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";

/** collection 名(排程任務的執行紀錄)。 */
export const SCHEDULED_JOB_RUNS_COLLECTION = "scheduled_job_runs";

/** 一次執行的狀態:先寫 `running` 佔住該時點,跑完改成 `succeeded` / `failed`。 */
export const SCHEDULED_JOB_RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
] as const;

export type ScheduledJobRunStatus = (typeof SCHEDULED_JOB_RUN_STATUSES)[number];

/**
 * 排程任務每個到期時點一筆執行紀錄(`scheduled-jobs/`)。唯一 `(key, scheduledFor)`:
 * 同一個工作、同一個時點不論被呼叫幾次(Scheduler 重送、兩個 instance 同時收到)都只有一筆能寫進來,
 * 寫進來的那一次才執行 handler —— 冪等靠這個索引,不靠程式先查再寫。
 *
 * 這不是業務資料:沒有操作者、不屬於任何組織,不掛基礎欄位與租戶 plugin;只經 `ScheduledJobRunsStore` 讀寫。
 */
@Schema({ collection: SCHEDULED_JOB_RUNS_COLLECTION, versionKey: false })
export class ScheduledJobRun {
  /** 工作 key(`registerScheduledJob` 登記的那一個)。 */
  @Prop({ type: String, required: true })
  key!: string;

  /**
   * 這次執行對應的到期時點:`15m` / `1h` 是該區間的起點,`daily@HH:mm` 是租戶當地那一天 HH:mm 的時點
   * (時區不同、時點相同的租戶共用一筆)。
   */
  @Prop({ type: Date, required: true })
  scheduledFor!: Date;

  @Prop({ type: String, required: true, enum: SCHEDULED_JOB_RUN_STATUSES })
  status!: ScheduledJobRunStatus;

  /** 取得這個時點、開始執行 handler 的時間。 */
  @Prop({ type: Date, required: true })
  startedAt!: Date;

  /** handler 結束的時間;還在 `running` 時為 null。 */
  @Prop({ type: Date, default: null })
  finishedAt!: Date | null;

  /** `failed` 時的錯誤訊息(截斷);其他狀態為 null。 */
  @Prop({ type: String, default: null })
  error!: string | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const ScheduledJobRunSchema =
  SchemaFactory.createForClass(ScheduledJobRun);

// 冪等:同一工作同一時點只有一筆
ScheduledJobRunSchema.index({ key: 1, scheduledFor: 1 }, { unique: true });
