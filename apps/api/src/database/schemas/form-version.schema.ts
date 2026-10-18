import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import type { FieldDef, Layout, Prefill, SummaryMap } from "@repo/domain/form";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/**
 * 版本狀態:
 * - `draft`:設計中、可改,`version = null`;一張表單同時最多一筆
 * - `publishing`:只存在於發布交易內的搶鎖狀態(步驟 2 搶到鎖、還沒切換完,ADR-0013);部分唯一索引保證同一時間至多一筆,
 *   交易外看不到
 * - `published`:凍結、供新增;`forms.currentVersion` 指它
 * - `retired`:發布下一版時前一版自動變成,或「退役目前版本」;既有提交照舊
 */
export const FORM_VERSION_STATUSES = [
  "draft",
  "publishing",
  "published",
  "retired",
] as const;

export type FormVersionStatus = (typeof FORM_VERSION_STATUSES)[number];

/** 表單版本(一版一筆;`docs/data-model.md`「form_versions」)。定義的形狀正本是 `@repo/domain/form`。 */
@Schema({ collection: "form_versions", timestamps: true, minimize: false })
export class FormVersion {
  @Prop({ type: String, required: true })
  formKey!: string;

  /** 正式版號:**發布步驟 2 搶鎖時配**(該表單最大版號 + 1);草稿為 null。 */
  @Prop({ type: Number, default: null })
  version!: number | null;

  @Prop({ type: String, required: true, enum: FORM_VERSION_STATUSES })
  status!: FormVersionStatus;

  /** 草稿每存一次 +1;存草稿與發布都要帶預期值,不符 → 409。 */
  @Prop({ type: Number, default: 0 })
  draftRevision!: number;

  /** 這份草稿以哪一版為基底複製出來(全新 = null)。 */
  @Prop({ type: Number, default: null })
  baseVersion!: number | null;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  fields!: FieldDef[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: () => ({ sections: [] }) })
  layout!: Layout;

  @Prop({ type: MongooseSchema.Types.Mixed, default: () => ({}) })
  summaryMap!: SummaryMap;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  prefills!: Prefill[];

  /** 發布時必填(步驟 2 寫入)。 */
  @Prop({ type: String, default: null })
  changelog!: string | null;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  publishedBy!: Types.ObjectId | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const FormVersionSchema = SchemaFactory.createForClass(FormVersion);

// 正式版號唯一(草稿的 null 不算):兩個發布同時配到同一個版號時,後寫的被擋下
FormVersionSchema.index(
  { formKey: 1, version: 1 },
  { unique: true, partialFilterExpression: { version: { $type: "number" } } },
);
// 一張表單同時最多一筆草稿、最多一筆發布中(部分唯一索引 `(formKey, status)`)。
// 拆兩條只用等值條件的部分索引(key 方向不同以免同形索引互撞),不依賴 partialFilterExpression 的 `$in`
FormVersionSchema.index(
  { formKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "draft" },
    name: "formKey_draft_unique",
  },
);
FormVersionSchema.index(
  { formKey: 1, status: -1 },
  {
    unique: true,
    partialFilterExpression: { status: "publishing" },
    name: "formKey_publishing_unique",
  },
);
// 基礎欄位(ADR-0007);版本屬表單,可見與否跟著表單走,不掛 tenantScope
FormVersionSchema.plugin(baseFieldsPlugin);
