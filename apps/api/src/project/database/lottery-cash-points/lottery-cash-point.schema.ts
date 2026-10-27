import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { MASTER_DATA_MODULE_KEY } from "../lottery-games/lottery-game.schema";

export const LOTTERY_CASH_POINTS_COLLECTION = "lottery_cash_points";

/**
 * 收銀點(專案規格 5.5;欄位規則正本 `docs/modules/project/master-data.md`「資料」):分店內收錢的位置,
 * 每個收銀點對應一個崗位。**不能刪除**,只能停用(沒有刪除端點,所以也不會有軟刪除的資料)。
 */
@Schema({ collection: LOTTERY_CASH_POINTS_COLLECTION, timestamps: true })
export class LotteryCashPoint {
  /** 分店(租戶隔離,ADR-0005);建立後不改。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 對應崗位:欄位管理「崗位」(`schedule-position`)的選項值;同一家分店內不重複。 */
  @Prop({ type: String, required: true })
  positionKey!: string;

  /** 名稱(預設帶崗位名稱,可改);同一家分店內不重複。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 排序:看板與下拉的順序(小的在前)。 */
  @Prop({ type: Number, default: 0 })
  order!: number;

  /** 啟用 / 停用;有開著的班或檯面上還有張數時不能停用(停用守門登記)。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 印表機(底座 `printers`,同分店);null = 列印時用分店預設。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  printerId!: Types.ObjectId | null;

  /** 備註(1000 字內)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `master-data`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryCashPointSchema =
  SchemaFactory.createForClass(LotteryCashPoint);

LotteryCashPointSchema.index({ orgId: 1, createdAt: 1 });
// 不能刪除 → 沒有軟刪除的資料,唯一索引直接守「同分店內不重複」(service 先查,這裡守同時送出)
LotteryCashPointSchema.index({ orgId: 1, positionKey: 1 }, { unique: true });
LotteryCashPointSchema.index({ orgId: 1, name: 1 }, { unique: true });
LotteryCashPointSchema.plugin(baseFieldsPlugin);
LotteryCashPointSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryCashPointSchema.path("moduleKey").default(MASTER_DATA_MODULE_KEY);
