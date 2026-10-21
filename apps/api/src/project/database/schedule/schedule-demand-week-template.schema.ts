import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_SETTINGS_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_DEMAND_WEEK_TEMPLATES_COLLECTION =
  "schedule_demand_week_templates";

/**
 * 人力需求週範本(規格 14.1、14.4):星期幾用哪些人力需求範本。可見與修改同人力需求範本。
 * `days` 固定 7 格,索引 0 = 星期日 … 6 = 星期六;每格是人力需求範本 id(只能選這一層看得到的)。
 */
@Schema({
  collection: SCHEDULE_DEMAND_WEEK_TEMPLATES_COLLECTION,
  timestamps: true,
})
export class ScheduleDemandWeekTemplate {
  /** 建立它的組織(只有這一層能改)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 名稱(例:一般週)。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 星期 → 人力需求範本 id[](7 格)。 */
  @Prop({ type: [[MongooseSchema.Types.ObjectId]], default: [] })
  days!: Types.ObjectId[][];

  /** 停用的週範本不出現在套用與預設週範本的選項裡。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleDemandWeekTemplateSchema = SchemaFactory.createForClass(
  ScheduleDemandWeekTemplate,
);

ScheduleDemandWeekTemplateSchema.index({ orgId: 1, createdAt: 1 });
ScheduleDemandWeekTemplateSchema.plugin(baseFieldsPlugin);
// 上層沿用到下層(ADR-0014):下層看得到所屬組織上層鏈建的;修改 / 刪除只在自己可見範圍內
ScheduleDemandWeekTemplateSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "inheritDown" },
});
ScheduleDemandWeekTemplateSchema.path("moduleKey").default(
  SCHEDULE_SETTINGS_MODULE_KEY,
);
