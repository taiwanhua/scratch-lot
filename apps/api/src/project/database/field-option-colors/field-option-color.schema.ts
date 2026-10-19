import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { TAG_PALETTE_KEYS } from "@repo/domain/project/tag-palette";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const FIELD_OPTION_COLORS_COLLECTION = "project_field_option_colors";

/**
 * 欄位選項的顏色(S2 專案臨時表,規格 18.5;第 0 章前綴例外:屬底座欄位管理,不屬任何專案模組)。
 * 一筆 = 一個選項(`fields`)的色票代號。升格時以 migration 搬進底座 `fields.color` 後刪表。
 *
 * - `orgId`:設定顏色的組織 = 該選項的擁有者(自訂選項的那一層;全域種子由根組織設定)
 * - `tenantId`:`orgId` 的租戶頂層(根組織 = null,即「全域選項的顏色」);由 service 推導,
 *   唯一 `(tenantId, fieldId)`
 */
@Schema({ collection: FIELD_OPTION_COLORS_COLLECTION, timestamps: true })
export class FieldOptionColor {
  /** 設定顏色的組織(租戶隔離,ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** `orgId` 的租戶頂層;根組織(全域選項的顏色)為 null。建立後不改。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  tenantId!: Types.ObjectId | null;

  /** 選項 `fields._id`。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  fieldId!: Types.ObjectId;

  /** 色票代號(`@repo/domain/project/tag-palette`);null = 不設定顏色。 */
  @Prop({ type: String, enum: [...TAG_PALETTE_KEYS], default: null })
  paletteKey!: string | null;
}

export const FieldOptionColorSchema =
  SchemaFactory.createForClass(FieldOptionColor);

FieldOptionColorSchema.index({ tenantId: 1, fieldId: 1 }, { unique: true });
FieldOptionColorSchema.index({ fieldId: 1 });
FieldOptionColorSchema.plugin(baseFieldsPlugin);
FieldOptionColorSchema.plugin(tenantScopePlugin);
