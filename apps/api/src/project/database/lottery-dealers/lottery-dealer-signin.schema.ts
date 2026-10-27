import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { DEALERS_MODULE_KEY } from "./lottery-dealer.schema";

export const LOTTERY_DEALER_SIGNINS_COLLECTION = "lottery_dealer_signins";

/**
 * 見簽(專案規格 5.2):一位經銷商每年每季一筆,唯一 `(dealerId, year, quarter)`;異動寫 audit_log。
 * 見簽日不限定落在該季。`orgId` 沿用經銷商的 `orgId`(看得到經銷商才看得到見簽)。
 */
@Schema({ collection: LOTTERY_DEALER_SIGNINS_COLLECTION, timestamps: true })
export class LotteryDealerSignin {
  /** 同經銷商的 `orgId`(可見範圍,ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 經銷商 `lottery_dealers._id`。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  dealerId!: Types.ObjectId;

  /** 年度(西元)。 */
  @Prop({ type: Number, required: true })
  year!: number;

  /** 季別 1–4。 */
  @Prop({ type: Number, required: true })
  quarter!: number;

  /** 見簽日(時點;租戶時區那一天 00:00)。 */
  @Prop({ type: Date, required: true })
  signedAt!: Date;

  /** 備註(1000 字內)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `dealers`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryDealerSigninSchema =
  SchemaFactory.createForClass(LotteryDealerSignin);

LotteryDealerSigninSchema.index({ orgId: 1, createdAt: 1 });
LotteryDealerSigninSchema.index(
  { dealerId: 1, year: 1, quarter: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryDealerSigninSchema.plugin(baseFieldsPlugin);
LotteryDealerSigninSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryDealerSigninSchema.path("moduleKey").default(DEALERS_MODULE_KEY);
