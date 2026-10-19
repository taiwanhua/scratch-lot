import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import type { Audience } from "@repo/domain/audience";

import type { NotificationSchedule } from "../../notifications/notification-schedule";
import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

export const NOTIFICATION_SETTINGS_COLLECTION = "notification_settings";

/**
 * 通知設定:租戶對通知類型的調整 —— **負責人提醒**的收件人(`audience`)與
 * **宣告了可調時間的類型**(負責人提醒或當事人通知)的提醒時間(`schedule`),
 * 每個租戶、每種類型至多一筆。沒有這筆、或欄位為 null = 用類型宣告的預設
 * (兩個欄位的「還原預設」各自把它寫回 null)。`updatedBy` / `updatedAt` 由基礎欄位提供。
 *
 * 以 `tenantId` 為邊界的租戶設定(沒有 `orgId`),不掛 tenantScope;讀寫一律帶操作者所在租戶的 `tenantId`。
 */
@Schema({ collection: NOTIFICATION_SETTINGS_COLLECTION, timestamps: true })
export class NotificationSetting {
  /** 租戶頂層 id。 */
  @Prop({ type: Types.ObjectId, required: true })
  tenantId!: Types.ObjectId;

  /** 通知類型 key(負責人提醒,或宣告了可調時間的當事人通知)。 */
  @Prop({ type: String, required: true })
  type!: string;

  /**
   * 收件人的人員條件(`@repo/domain/audience`;不含「所有人」、不含所屬組織欄 ——
   * 組織範圍由類型宣告)。null = 用類型宣告的預設。
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  audience!: Audience | null;

  /**
   * 提醒時間(`notifications/notification-schedule.ts`;寫法必須是類型宣告的那一種)。
   * null = 用類型宣告的預設;當事人通知只會有這一欄。
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  schedule!: NotificationSchedule | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const NotificationSettingSchema =
  SchemaFactory.createForClass(NotificationSetting);

NotificationSettingSchema.index({ tenantId: 1, type: 1 }, { unique: true });
// 基礎欄位(ADR-0007);以 tenantId 為邊界的租戶設定,不掛 tenantScope
NotificationSettingSchema.plugin(baseFieldsPlugin);
