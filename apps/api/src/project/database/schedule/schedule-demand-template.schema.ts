import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_TASK_ROLES } from "@repo/domain/project/schedule-settings";
import { TAG_PALETTE_KEYS } from "@repo/domain/project/tag-palette";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_SETTINGS_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_DEMAND_TEMPLATES_COLLECTION = "schedule_demand_templates";

/** 一筆執行任務 = 職責 + 任務內容(規格名詞表「執行任務」)。 */
export interface ScheduleTemplateTask {
  /** 在這筆範本內唯一;套用到人力需求時另產生新的 id。 */
  taskId: string;
  /** 職責:負責人 `leader` / 協同 `helper`。 */
  role: string;
  /** 任務內容(欄位管理「執行任務」的選項 value)。 */
  taskKey: string;
}

const TaskSchema = new MongooseSchema<ScheduleTemplateTask>(
  {
    taskId: { type: String, required: true },
    role: { type: String, enum: [...SCHEDULE_TASK_ROLES], required: true },
    taskKey: { type: String, required: true },
  },
  { _id: false },
);

/**
 * 人力需求範本(規格 14.1、14.4):一天裡的一個班(不含日期、不分星期幾、沒有休息)。
 * 可見 = 自己這一層 + 所有上層;只有建立它的那一層(`orgId`)能改。
 */
@Schema({ collection: SCHEDULE_DEMAND_TEMPLATES_COLLECTION, timestamps: true })
export class ScheduleDemandTemplate {
  /** 建立它的組織(只有這一層能改)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 名稱(例:早班)。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 簡稱(1–2 字,例:早)。 */
  @Prop({ type: String, required: true })
  shortName!: string;

  /** 開始(`HH:mm`,到分鐘)。 */
  @Prop({ type: String, required: true })
  startTime!: string;

  /** 結束(`HH:mm`;比開始早 = 跨午夜)。 */
  @Prop({ type: String, required: true })
  endTime!: string;

  /** 崗位(欄位管理「崗位」的選項 value)。 */
  @Prop({ type: String, required: true })
  positionKey!: string;

  /** 執行任務:負責人 0–1 筆、協同 0–10 筆。 */
  @Prop({ type: [TaskSchema], default: [] })
  tasks!: ScheduleTemplateTask[];

  /** 顏色(標籤色票代號);null = 不設定。 */
  @Prop({ type: String, enum: [...TAG_PALETTE_KEYS, null], default: null })
  paletteKey!: string | null;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleDemandTemplateSchema = SchemaFactory.createForClass(
  ScheduleDemandTemplate,
);

ScheduleDemandTemplateSchema.index({ orgId: 1, createdAt: 1 });
ScheduleDemandTemplateSchema.plugin(baseFieldsPlugin);
// 上層沿用到下層(ADR-0014):下層看得到所屬組織上層鏈建的;修改 / 刪除只在自己可見範圍內
ScheduleDemandTemplateSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "inheritDown" },
});
ScheduleDemandTemplateSchema.path("moduleKey").default(
  SCHEDULE_SETTINGS_MODULE_KEY,
);
