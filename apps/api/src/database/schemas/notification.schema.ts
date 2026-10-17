import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

export const NOTIFICATIONS_COLLECTION = "notifications";

/** 通知保留天數:`createdAt` 超過就由 TTL 索引自動刪除(底座規格第 5 章)。 */
export const NOTIFICATION_RETENTION_DAYS = 90;

/**
 * 通知(底座規格第 5 章;CONTEXT.md「通知」):一位收件人收到的一則,由 `NotificationService.notify`
 * 在觸發它的動作的同一個交易裡寫入。標題與內容在寫入當下依通知類型的範本、以收件人的語言產生。
 *
 * 屬收件人自己的資料:只由收件人經 API 讀取與標已讀(依 `recipientId`,與目前組織無關),
 * 不掛 tenantScope(同 `user_preferences`);`tenantId` / `orgId` 記事件所在的租戶與組織。
 */
@Schema({ collection: NOTIFICATIONS_COLLECTION, timestamps: true })
export class Notification {
  /** 事件所在的租戶頂層 id;根組織的事件為 null。 */
  @Prop({ type: Types.ObjectId, default: null })
  tenantId!: Types.ObjectId | null;

  /** 事件所在的組織(負責人提醒的組織範圍由它起算)。 */
  @Prop({ type: Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 收件人(`users._id`)。 */
  @Prop({ type: Types.ObjectId, required: true })
  recipientId!: Types.ObjectId;

  /** 通知類型 key(登記表正本 `apps/api/src/notifications/notification-registry.ts`)。 */
  @Prop({ type: String, required: true })
  type!: string;

  /** 依類型範本產生(收件人的語言)。 */
  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true })
  body!: string;

  /** 連結目標的種類;頁面路由由連結登記表(`refType` → 路由)決定。null = 沒有連結。 */
  @Prop({ type: String, default: null })
  refType!: string | null;

  @Prop({ type: String, default: null })
  refId!: string | null;

  /**
   * 防止同一事件重複通知:`(recipientId, dedupeKey)` 唯一 —— 同一位收件人、同一個 `dedupeKey`
   * 只有一筆,重複呼叫 `notify` 不再寫入、不再送信號、不再寄信。
   */
  @Prop({ type: String, required: true })
  dedupeKey!: string;

  /**
   * 這則通知送出的管道(收件人的偏好開著的那些,如 `["in-app", "email"]`)。
   * 通知清單與未讀數只算含 `in-app` 的;收件人關掉站內通知時仍寫一筆(只寄信),供去重。
   */
  @Prop({ type: [String], default: [] })
  channels!: string[];

  /** 已讀時間;null = 未讀。 */
  @Prop({ type: Date, default: null })
  readAt!: Date | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipientId: 1, dedupeKey: 1 }, { unique: true });
// 通知清單(新到舊)與未讀數
NotificationSchema.index({ recipientId: 1, channels: 1, createdAt: -1 });
NotificationSchema.index({ recipientId: 1, channels: 1, readAt: 1 });
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 },
);
// 基礎欄位(ADR-0007);通知屬收件人、依 recipientId 讀寫,不掛 tenantScope(同 user_preferences)
NotificationSchema.plugin(baseFieldsPlugin);
