import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/** token 所屬帳號體系(ADR-0003):user=後台使用者、customer=前台會員。 */
export const ACCOUNT_TYPES = ["user", "customer"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** 長效 refresh token(ADR-0003):獨立 collection 存雜湊,支援輪替與登出所有裝置。 */
@Schema({ collection: "refresh_tokens", timestamps: true })
export class RefreshToken {
  /** = 帳號文件的 `_id`。 */
  @Prop({ type: Types.ObjectId, required: true })
  accountId!: Types.ObjectId;

  /** 帳號體系:user / customer(決定 accountId 指向哪張表)。 */
  @Prop({ type: String, required: true, enum: ACCOUNT_TYPES })
  accountType!: AccountType;

  /** token 雜湊(不存明碼)。 */
  @Prop({ type: String, required: true })
  tokenHash!: string;

  /** 到期時間;逾期即失效。 */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  /**
   * 輪替作廢時間:refresh 每次使用即輪替,舊筆在此記時間;有值的 token 再被使用視為外洩
   * (該帳號全部 refresh 作廢)。主動登出 / 登出所有裝置走軟刪除(deletedAt,ADR-0007),不寫此欄。
   */
  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  /** 裝置資訊(供「登出所有裝置」辨識,選填)。 */
  @Prop({ type: MongooseSchema.Types.Mixed })
  deviceInfo?: Record<string, unknown>;

  /**
   * 這個 session 的當前組織(`switchOrg`):refresh 換發的 access token 沿用它,
   * 切換組織後不會因 access token 過期而跳回預設組織;會員(customer)為 null。
   */
  @Prop({ type: Types.ObjectId, default: null })
  currentOrgId!: Types.ObjectId | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

RefreshTokenSchema.index({ accountType: 1, accountId: 1 });
// TTL:到期即由 MongoDB 自動清除
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// 基礎欄位(ADR-0007);token 屬帳號、非租戶資料,不掛 tenantScope
RefreshTokenSchema.plugin(baseFieldsPlugin);
