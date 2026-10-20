import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_RULE_LEVELS } from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_SETTINGS_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_SETTINGS_COLLECTION = "schedule_settings";

/**
 * 排班規則與自動排班條件的設定(規格 14.1、14.2):一列 = 某組織對某條規則的**自訂**。
 * 沒有列 = 沿用;生效值沿組織樹往上找(自己 → 上層 → … → 最上層組織),最後用程式預設
 * (`@repo/domain/project/schedule-settings` 的定義)。自動排班條件整組繼承:
 * 一個組織有任何一條自動排班條件的列,就整組以它為準。
 *
 * - 唯一 `(orgId, key)`(只算未刪除的,partial index);[還原] = 軟刪除
 * - `value` 的形狀依規則定義的 `valueType`
 */
@Schema({ collection: SCHEDULE_SETTINGS_COLLECTION, timestamps: true })
export class ScheduleSetting {
  /** 自訂這條規則的組織。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 規則 / 自動排班條件的 key(定義清單裡的一個)。 */
  @Prop({ type: String, required: true })
  key!: string;

  /** 開關(例:同一時段兼多個崗位;自動排班條件的勾選)。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 值(物件,形狀依定義的 `valueType`)。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  value!: Record<string, unknown>;

  /** 等級:限制 `limit` / 提醒 `reminder`;沒有等級的規則為 null。 */
  @Prop({ type: String, enum: [...SCHEDULE_RULE_LEVELS, null], default: null })
  level!: string | null;

  /** 排序(檢核清單;自動排班條件的勾選順序)。 */
  @Prop({ type: Number, default: 0 })
  order!: number;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleSettingSchema =
  SchemaFactory.createForClass(ScheduleSetting);

// 某組織某條規則只有一筆未刪除的自訂;[還原] 軟刪除後可以再自訂
ScheduleSettingSchema.index(
  { orgId: 1, key: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
ScheduleSettingSchema.index({ orgId: 1, createdAt: 1 });
ScheduleSettingSchema.plugin(baseFieldsPlugin);
// 上層沿用到下層(ADR-0014):下層看得到所屬組織上層鏈建的;修改 / 刪除只在自己可見範圍內
ScheduleSettingSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "inheritDown" },
});
ScheduleSettingSchema.path("moduleKey").default(SCHEDULE_SETTINGS_MODULE_KEY);
