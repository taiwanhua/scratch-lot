import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { INVENTORY_MODULE_KEY } from "./inventory-module-key";

export const LOTTERY_ALLOCATIONS_COLLECTION = "lottery_allocations";

/**
 * 預計要給本數(專案規格 7.6):分店 × 遊戲一筆,唯一 `(orgId, gameId)`;每次調整寫 audit_log。
 * 「已給」即時計算(進貨 + 調入 − 調出,`LotteryAllocationsService.allocationStatus`),不存。
 */
@Schema({ collection: LOTTERY_ALLOCATIONS_COLLECTION, timestamps: true })
export class LotteryAllocation {
  /** 分店。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  gameId!: Types.ObjectId;

  /** 預計要給的本數(0 以上的整數)。 */
  @Prop({ type: Number, required: true, min: 0 })
  plannedBooks!: number;

  /** 備註。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `inventory`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryAllocationSchema =
  SchemaFactory.createForClass(LotteryAllocation);

LotteryAllocationSchema.index(
  { orgId: 1, gameId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryAllocationSchema.plugin(baseFieldsPlugin);
LotteryAllocationSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryAllocationSchema.path("moduleKey").default(INVENTORY_MODULE_KEY);
