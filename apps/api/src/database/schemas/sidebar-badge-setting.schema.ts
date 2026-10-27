import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import type { Audience } from "@repo/domain/audience";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

export const SIDEBAR_BADGE_SETTINGS_COLLECTION = "sidebar_badge_settings";

/**
 * 側欄數字設定:租戶調整「誰看得到某個模組的側欄數字」(人員條件),每個租戶、每個模組至多一筆。
 * 沒有這筆、或 `audience` 為 null = 用程式登記的預設(綁了模組就算;登記填了 `requires` 時還要那條權限)。
 * 「綁了模組」一律是前提,人員條件只在它之上再收窄。`updatedBy` / `updatedAt` 由基礎欄位提供。
 *
 * 以 `tenantId` 為邊界的租戶設定(沒有 `orgId`),不掛 tenantScope;讀寫一律帶操作者所在租戶的 `tenantId`
 * (同 `notification_settings`)。
 */
@Schema({ collection: SIDEBAR_BADGE_SETTINGS_COLLECTION, timestamps: true })
export class SidebarBadgeSetting {
  /** 租戶頂層 id。 */
  @Prop({ type: Types.ObjectId, required: true })
  tenantId!: Types.ObjectId;

  /** 登記側欄數字的模組 key(`SidebarBadgeRegistry`)。 */
  @Prop({ type: String, required: true })
  moduleKey!: string;

  /**
   * 看得到數字的人員條件(`@repo/domain/audience`;不含「所有人」、不含所屬組織欄)。
   * null = 用程式登記的預設。
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  audience!: Audience | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const SidebarBadgeSettingSchema =
  SchemaFactory.createForClass(SidebarBadgeSetting);

SidebarBadgeSettingSchema.index(
  { tenantId: 1, moduleKey: 1 },
  { unique: true },
);
// 基礎欄位(ADR-0007);以 tenantId 為邊界的租戶設定,不掛 tenantScope
SidebarBadgeSettingSchema.plugin(baseFieldsPlugin);
