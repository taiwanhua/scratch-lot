import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

export const USER_PREFERENCES_COLLECTION = "user_preferences";

/**
 * 個人偏好(每個後台使用者一筆):跟著帳號走的設定,換裝置登入也一樣。
 * 能存哪些 key、型別與預設值由登記決定(`apps/api/src/user-preferences/user-preference-registry.ts`;
 * 底座與專案各自登記),未登記的 key 寫不進來。跟著裝置的設定(外觀、側欄收合)不在這裡,存瀏覽器。
 */
@Schema({ collection: USER_PREFERENCES_COLLECTION, timestamps: true })
export class UserPreference {
  /** = `users._id`;每個使用者至多一筆(唯一索引)。 */
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /**
   * `{ <登記的 key>: 值 }`;只存使用者改過的 key,沒存的 key 讀取時回登記的預設值。
   * 寫入一律經 `UserPreferencesService` 驗過 key 與型別(值 `null` = 拿掉這個 key、回到預設)。
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  settings!: Record<string, unknown>;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const UserPreferenceSchema =
  SchemaFactory.createForClass(UserPreference);

UserPreferenceSchema.index({ userId: 1 }, { unique: true });
// 基礎欄位(ADR-0007);偏好屬帳號、非租戶資料,不掛 tenantScope(同 refresh_tokens)
UserPreferenceSchema.plugin(baseFieldsPlugin);
