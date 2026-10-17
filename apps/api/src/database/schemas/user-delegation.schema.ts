import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

export const USER_DELEGATIONS_COLLECTION = "user_delegations";

/**
 * 代理人(《底座規格》3.7 B15):`userId` 在 `[startAt, endAt)` 期間不在時,進關解析審核者時輪到他的
 * 任務改派給 `delegateUserId`(`apps/api/src/workflows/workflow-engine/assignee-delegation.service.ts`)。
 * 只能設定自己的(個人設定的「代理人」分頁);同一個人的代理期間不重疊。
 *
 * 起訖是時點:admin 依租戶時區選日期,起 = 當天 00:00、迄 = 結束那天的隔天 00:00(= 當天 24:00,不含)。
 * 屬帳號、非租戶資料(同 user_preferences),不掛 tenantScope;「代理人在本租戶」在派任當下判斷。
 * 已結束的代理唯讀、保留紀錄;未結束的刪除走軟刪除(`deletedAt`)。`createdAt` 由基礎欄位提供。
 */
@Schema({ collection: USER_DELEGATIONS_COLLECTION, timestamps: true })
export class UserDelegation {
  /** 被代理的人(設定者本人;= `users._id`)。 */
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 代理人(= `users._id`;不能是自己)。 */
  @Prop({ type: Types.ObjectId, required: true })
  delegateUserId!: Types.ObjectId;

  /** 代理開始(含)。 */
  @Prop({ type: Date, required: true })
  startAt!: Date;

  /** 代理結束(不含;選的結束日在租戶時區的 24:00)。 */
  @Prop({ type: Date, required: true })
  endAt!: Date;

  /** 備註(選填)。 */
  @Prop({ type: String, default: null })
  note!: string | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const UserDelegationSchema =
  SchemaFactory.createForClass(UserDelegation);

// 個人清單(依開始排序)與派任時「這些人此刻在不在代理期間」都以 userId + startAt 查
UserDelegationSchema.index({ userId: 1, startAt: 1 });
// 基礎欄位(ADR-0007);屬帳號、非租戶資料,不掛 tenantScope(同 user_preferences)
UserDelegationSchema.plugin(baseFieldsPlugin);
