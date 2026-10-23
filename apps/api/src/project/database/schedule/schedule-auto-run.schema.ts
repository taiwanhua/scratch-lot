import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_AUTO_RUN_MODES } from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MANAGE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_AUTO_RUNS_COLLECTION = "schedule_auto_runs";

/** 這次用的一條自動排班條件(快照:勾選與順序)。 */
export interface ScheduleAutoRunCondition {
  key: string;
  enabled: boolean;
}

/** 這次的統計。 */
export interface ScheduleAutoRunStats {
  /** 填入的人次(自動填進紀錄筆數) */
  filledCount: number;
  /** 排不滿的執行任務筆數 */
  unfilledCount: number;
  /** 補上的人力需求筆數 / 天數(先以預設人力需求週範本補上) */
  addedDemandCount: number;
  addedDemandDays: number;
  /** 重排前清掉的填進紀錄筆數 */
  clearedCount: number;
  /** 新建 / 延長的排班筆數 */
  createdEntryCount: number;
  extendedEntryCount: number;
}

/**
 * 延續同一人的排班時被延長的既有排班:延長前 / 後的上下班時間與休息(之後「清除自動排入的人」
 * 要不要縮回由使用者決定,先記資料;`docs/modules/project/schedule.md` 待決)。
 */
export interface ScheduleAutoRunExtendedEntry {
  entryId: Types.ObjectId;
  before: { startAt: Date; endAt: Date; breakMinutes: number };
  after: { startAt: Date; endAt: Date; breakMinutes: number };
}

const ConditionSchema = new MongooseSchema<ScheduleAutoRunCondition>(
  {
    key: { type: String, required: true },
    enabled: { type: Boolean, required: true },
  },
  { _id: false },
);

/**
 * 自動排班的執行紀錄(規格 14.1 `schedule_auto_runs`、14.5「自動排班」):範圍、方式、條件快照、
 * seed(系統產生、使用者看不到,只用來追查和測試)、演算法版本、統計、被延長的既有排班的延長前時間;by / at = `createdBy` / `createdAt`。
 * 只新增(不改不刪);填進紀錄的 `autoRunId` 指回這裡。檢核面板最上方的摘要讀這家店這個月最新的一筆。
 */
@Schema({ collection: SCHEDULE_AUTO_RUNS_COLLECTION, timestamps: true })
export class ScheduleAutoRun {
  /** 分店(歸屬組織)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 月份 `YYYY-MM`。 */
  @Prop({ type: String, required: true })
  month!: string;

  /** 範圍:半開的時點區間 `[from, to)`(租戶時區的 00:00;在這個月內)。 */
  @Prop({ type: Date, required: true })
  from!: Date;

  @Prop({ type: Date, required: true })
  to!: Date;

  /** 方式:只填空位 / 重排自動排入的人 / 全部重排。 */
  @Prop({ type: String, enum: [...SCHEDULE_AUTO_RUN_MODES], required: true })
  mode!: string;

  /** 條件快照(依這次的順序)。 */
  @Prop({ type: [ConditionSchema], default: [] })
  conditions!: ScheduleAutoRunCondition[];

  /** 先以預設人力需求週範本補上人力需求時用的週範本(沒補 = null)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  weekTemplateId!: Types.ObjectId | null;

  /** 亂數種子(32 位元正整數)。 */
  @Prop({ type: Number, required: true })
  seed!: number;

  /** 演算法版本(`SCHEDULE_AUTO_RUN_ALGORITHM_VERSION`)。 */
  @Prop({ type: String, required: true })
  algorithmVersion!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  stats!: ScheduleAutoRunStats;

  /** 延續同一人的排班時被延長的既有排班(延長前 / 後) */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  extendedEntries!: ScheduleAutoRunExtendedEntry[];

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleAutoRunSchema =
  SchemaFactory.createForClass(ScheduleAutoRun);

ScheduleAutoRunSchema.index({ orgId: 1, month: 1, createdAt: -1 });
ScheduleAutoRunSchema.plugin(baseFieldsPlugin);
// 屬於分店、不共用(同排班表其他表)
ScheduleAutoRunSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleAutoRunSchema.path("moduleKey").default(SCHEDULE_MANAGE_MODULE_KEY);
