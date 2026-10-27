import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_RELATIONSHIPS_COLLECTION = "lottery_relationships";

/**
 * 刮刮樂的關聯種類(專案規格 5.4;命名照底座 `business_relationships`:`<第一方單數>_<第二方單數>`,組織在前):
 *
 * | type                                    | firstId              | secondId                  | meta                                   |
 * | --------------------------------------- | -------------------- | ------------------------- | -------------------------------------- |
 * | `lottery_dealer_lottery_dealer_contact` | 經銷商               | 關係人                    | `{ role: agent / trustee / introducer }` |
 * | `lottery_dealer_lottery_dealer`         | 甲類                 | 乙類(共同銷售處所)        | `{}`                                   |
 * | `org_lottery_dealer`                    | 分店(`orgs`)         | 乙類(對應分店,一對一)     | `{}`                                   |
 *
 * `org_lottery_bank_account`(使用組織 → 帳戶)由帳戶管理在同一張表新增 type。
 */
export const LOTTERY_RELATIONSHIP_TYPES = [
  "lottery_dealer_lottery_dealer_contact",
  "lottery_dealer_lottery_dealer",
  "org_lottery_dealer",
] as const;

export type LotteryRelationshipType =
  (typeof LOTTERY_RELATIONSHIP_TYPES)[number];

/**
 * 關聯(形狀比照底座 `business_relationships`:`{ tenantId, type, firstId, secondId, thirdId, meta }`)。
 * 與底座那張的差別:這是**專案租戶資料**,照專案資料登記的契約掛 `tenantScopePlugin`(`orgId` = 關聯所屬
 * 經銷商的 `orgId`,看得到經銷商就看得到它的關聯);`tenantId` 由 service 寫入,是唯一鍵與跨可見範圍
 * 查詢(對應分店是否已被占用)的邊界。解除關聯 = 軟刪除(ADR-0007),唯一索引只算未刪除的列。
 * 不做有效期間;每次異動寫 audit_log。
 */
@Schema({ collection: LOTTERY_RELATIONSHIPS_COLLECTION, timestamps: true })
export class LotteryRelationship {
  /** 關聯所屬經銷商的 `orgId`(可見範圍,ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 租戶頂層 id(根組織的資料為 null);唯一鍵的第一欄。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  tenantId!: Types.ObjectId | null;

  /** 關聯種類(決定 first / second 各是誰)。 */
  @Prop({ type: String, enum: LOTTERY_RELATIONSHIP_TYPES, required: true })
  type!: LotteryRelationshipType;

  /** 命名順序在前者的 id。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  firstId!: Types.ObjectId;

  /** 命名順序在後者的 id。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  secondId!: Types.ObjectId;

  /** 三方關聯的第三方;目前的種類都是 null。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  thirdId!: Types.ObjectId | null;

  /** 關聯自身資訊(經銷商 → 關係人:`{ role }`)。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  meta!: Record<string, unknown>;
}

export const LotteryRelationshipSchema =
  SchemaFactory.createForClass(LotteryRelationship);

// 唯一鍵 (tenantId, type, firstId, secondId, meta.role):同一人對同一經銷商可同時擔任多種身分
LotteryRelationshipSchema.index(
  { tenantId: 1, type: 1, firstId: 1, secondId: 1, "meta.role": 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
// 反查:某位關係人 / 乙類 / 分店被誰關聯
LotteryRelationshipSchema.index({ tenantId: 1, type: 1, secondId: 1 });
LotteryRelationshipSchema.index({ orgId: 1, createdAt: 1 });
LotteryRelationshipSchema.plugin(baseFieldsPlugin);
LotteryRelationshipSchema.plugin(tenantScopePlugin);
