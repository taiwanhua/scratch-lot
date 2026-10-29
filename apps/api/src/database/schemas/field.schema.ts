import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import { TAG_PALETTE_KEYS } from "@repo/domain/tag-palette";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import { tenantScopePlugin } from "../plugins/tenant-scope.plugin";

/** 欄位選項(ADR-0005):orgId null=全域種子、有值=租戶自訂;下架不刪。 */
@Schema({ collection: "fields", timestamps: true })
export class Field {
  /** 種子選項的冪等識別 `<類別 key>.<value>`(如 `gender.male`,ADR-0002);租戶自訂選項無 key、以 _id 識別。 */
  @Prop({ type: String })
  key?: string;

  /** 所屬欄位類別 id。 */
  @Prop({ type: Types.ObjectId, required: true })
  categoryId!: Types.ObjectId;

  /** null=全域種子;有值=租戶自訂。 */
  @Prop({ type: Types.ObjectId, default: null })
  orgId!: Types.ObjectId | null;

  /** 顯示名稱(如「男」)。 */
  @Prop({ type: String, required: true })
  label!: string;

  /** 儲存值(如「male」)。 */
  @Prop({ type: String, required: true })
  value!: string;

  /** 下拉排序。 */
  @Prop({ type: Number, default: 0 })
  order!: number;

  /** 停用即新填寫不再出現(既有資料不受影響)。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 保護種子選項。 */
  @Prop({ type: Boolean, default: false })
  isSystem!: boolean;

  /** 描述說明(選填)。 */
  @Prop({ type: String })
  description?: string;

  /**
   * 標籤色票代號(`@repo/domain/tag-palette`);null / 缺欄位 = 不設定顏色。
   * 誰能設 = 誰能切 `enabled`(自訂選項限加它的那一層、種子限根組織);種子宣告的顏色是初始 seed 值(ADR-0002)。
   */
  @Prop({ type: String, enum: [...TAG_PALETTE_KEYS, null], default: null })
  color?: string | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const FieldSchema = SchemaFactory.createForClass(Field);

FieldSchema.index({ categoryId: 1, orgId: 1 });
FieldSchema.index({ key: 1 }, { unique: true, sparse: true });
// 同一類別、同一組織下 value 不可重複(field-manager.md「待辦」);
// 全域種子的 orgId 為 null,故「自訂選項與全域選項同 value」此索引擋不到 —
// 那條是合併清單的語意需求,由 FieldsService 的表單驗證擋(FIELD_VALUE_DUPLICATE)。
FieldSchema.index({ categoryId: 1, orgId: 1, value: 1 }, { unique: true });
// 基礎欄位(ADR-0007)+ 租戶自訂選項限縮在可見組織內;orgId null 的全域種子對所有人可見(ADR-0005 $or)
FieldSchema.plugin(baseFieldsPlugin);
FieldSchema.plugin(tenantScopePlugin, { allowGlobal: true });
