import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_CALENDAR_DAY_TYPES } from "@repo/domain/project/schedule-settings";
import { TAG_PALETTE_KEYS } from "@repo/domain/tag-palette";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MANAGE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_CALENDAR_DAYS_COLLECTION = "schedule_calendar_days";

/**
 * 行事曆(規格 14.1、14.5「行事曆」):店休(擋下排班)/ 特殊日(只做背景色)。
 * 唯一 `(orgId, date)`(只算未刪除的,partial index);某家店某天的行事曆以**最接近的那一層**為準
 * (自己 → 上層 → … → 最上層組織)。
 */
@Schema({ collection: SCHEDULE_CALENDAR_DAYS_COLLECTION, timestamps: true })
export class ScheduleCalendarDay {
  /** 設定這一天的組織。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 日期:租戶時區那天 00:00 的時點(入口用租戶時區正規化)。 */
  @Prop({ type: Date, required: true })
  date!: Date;

  /** 類型:店休 `closed` / 特殊日 `special`(程式固定)。 */
  @Prop({
    type: String,
    enum: [...SCHEDULE_CALENDAR_DAY_TYPES],
    required: true,
  })
  type!: string;

  /** 特殊日類別(欄位管理「特殊日類別」的選項 value);店休為 null。 */
  @Prop({ type: String, default: null })
  category!: string | null;

  /** 名稱(例:店慶);店休可空白。 */
  @Prop({ type: String, default: null })
  name!: string | null;

  /** 說明(選填)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 顏色(標籤色票代號;特殊日的背景色);店休為 null(一律灰色)。 */
  @Prop({ type: String, enum: [...TAG_PALETTE_KEYS, null], default: null })
  paletteKey!: string | null;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleCalendarDaySchema =
  SchemaFactory.createForClass(ScheduleCalendarDay);

// 同一層同一天只有一筆未刪除的(規格 14.1);軟刪除的不算
ScheduleCalendarDaySchema.index(
  { orgId: 1, date: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
ScheduleCalendarDaySchema.index({ orgId: 1, createdAt: 1 });
ScheduleCalendarDaySchema.plugin(baseFieldsPlugin);
// 上層沿用到下層(ADR-0014):下層看得到所屬組織上層鏈建的;修改 / 刪除只在自己可見範圍內
ScheduleCalendarDaySchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "inheritDown" },
});
ScheduleCalendarDaySchema.path("moduleKey").default(SCHEDULE_MANAGE_MODULE_KEY);
