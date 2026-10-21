import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  REQUISITION_MODULE_KEY,
  REQUISITION_REFERENCE_TYPES,
  type RequisitionReferenceType,
} from "@repo/domain/project/lottery";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_REQUISITION_LINES_COLLECTION = "lottery_requisition_lines";

/** 引用這張叫貨單的單據(進貨單 / 調貨單;一張叫貨單只能對應一張)。 */
export interface RequisitionReferencedBy {
  type: RequisitionReferenceType;
  submissionId: Types.ObjectId;
}

const REFERENCED_BY_TYPE = new MongooseSchema<RequisitionReferencedBy>(
  {
    type: { type: String, enum: REQUISITION_REFERENCE_TYPES, required: true },
    submissionId: { type: MongooseSchema.Types.ObjectId, required: true },
  },
  { _id: false },
);

/**
 * 叫貨明細副本(專案規格 8.1;正本 `docs/modules/project/purchasing.md`「叫貨單」):
 * 叫貨單**完成時**寫(分店 × 遊戲 × 本數,唯讀);作廢後補 `voidedAt`(不刪除);被進貨單 / 調貨單引用時寫
 * `referencedBy`(`requisition-reference.ts`)。採購清單與「在途」只讀這張表,草稿與審核中的單不在這裡。
 */
@Schema({ collection: LOTTERY_REQUISITION_LINES_COLLECTION, timestamps: true })
export class LotteryRequisitionLine {
  /** 叫貨分店(單上的「叫貨分店」欄)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 叫貨單(表單提交 id)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  requisitionId!: Types.ObjectId;

  /** 叫貨單單號(快照;採購清單顯示)。 */
  @Prop({ type: String, default: null })
  serialNo!: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  gameId!: Types.ObjectId;

  /** 本數(正整數)。 */
  @Prop({ type: Number, required: true, min: 1 })
  books!: number;

  /** 明細備註。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 叫貨單完成的時間。 */
  @Prop({ type: Date, required: true })
  completedAt!: Date;

  /** 叫貨單作廢的時間;null = 有效。 */
  @Prop({ type: Date, default: null })
  voidedAt!: Date | null;

  /** 被哪一張進貨單 / 調貨單引用;null = 待購買。 */
  @Prop({ type: REFERENCED_BY_TYPE, default: null })
  referencedBy!: RequisitionReferencedBy | null;

  /** 模組 key(plugin 宣告;本表固定 `purchasing.requisition`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryRequisitionLineSchema = SchemaFactory.createForClass(
  LotteryRequisitionLine,
);

// 一張叫貨單同一個遊戲一列(完成時重送不重複寫)
LotteryRequisitionLineSchema.index(
  { requisitionId: 1, gameId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
// 採購清單 / 在途:有效且未被引用的列
LotteryRequisitionLineSchema.index({
  tenantId: 1,
  voidedAt: 1,
  "referencedBy.submissionId": 1,
});
LotteryRequisitionLineSchema.index({ orgId: 1, gameId: 1 });
LotteryRequisitionLineSchema.plugin(baseFieldsPlugin);
LotteryRequisitionLineSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryRequisitionLineSchema.path("moduleKey").default(REQUISITION_MODULE_KEY);
