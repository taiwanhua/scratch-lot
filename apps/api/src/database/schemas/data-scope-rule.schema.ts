import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/** 命中規則的頂層合成方式(預設 OR)。 */
export const DATA_SCOPE_COMBINE_OPS = ["AND", "OR"] as const;

export type DataScopeCombineOp = (typeof DATA_SCOPE_COMBINE_OPS)[number];

/** 資料範圍規則(ADR-0008):每個資料目標(`(collection, moduleKey)`)至多一份。 */
// `collection` 為 base-schema 指定的欄位名(資料目標);Mongoose 視其為保留字,明確放行
@Schema({
  collection: "data_scope_rules",
  timestamps: true,
  suppressReservedKeysWarning: true,
})
export class DataScopeRule {
  /** 資料目標的 collection(對應的業務 collection 名);與 `moduleKey` 合為唯一鍵。 */
  @Prop({ type: String, required: true })
  collection!: string;

  /** 資料目標的模組 key:規則只套在該 collection 裡 `moduleKey` 等於它的資料上。 */
  @Prop({ type: String, required: true })
  moduleKey!: string;

  /** 多條規則命中同一人時的合成:OR=聯集(變多)/ AND=交集(變少)。 */
  @Prop({ type: String, enum: DATA_SCOPE_COMBINE_OPS, default: "OR" })
  combineOp!: DataScopeCombineOp;

  /** `{ audience: 人員條件(@repo/domain/audience), filter: 條件組合巢狀樹 }`;形狀正本 docs/modules/data-scope.md。 */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  rules!: Record<string, unknown>[];
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const DataScopeRuleSchema = SchemaFactory.createForClass(DataScopeRule);

DataScopeRuleSchema.index({ collection: 1, moduleKey: 1 }, { unique: true });
// 基礎欄位(ADR-0007);根組織專屬設定,不掛 tenantScope
DataScopeRuleSchema.plugin(baseFieldsPlugin);
