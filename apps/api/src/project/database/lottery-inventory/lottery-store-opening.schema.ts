import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { INVENTORY_MODULE_KEY } from "./inventory-module-key";

export const LOTTERY_STORE_OPENINGS_COLLECTION = "lottery_store_openings";

export const STORE_OPENING_ACTIONS = ["close", "reopen"] as const;
export type StoreOpeningAction = (typeof STORE_OPENING_ACTIONS)[number];

/** 期初建檔結束 / 重新開啟的一筆歷程(只加不改)。 */
export interface StoreOpeningHistoryEntry {
  action: StoreOpeningAction;
  at: Date;
  by: Types.ObjectId;
  /** 重新開啟的原因(必填);結束為 null */
  reason: string | null;
}

/**
 * 分店的期初建檔狀態(期初建檔規格第 2 節):一店一筆,比照 `lottery_store_count_modes`
 * (`orgId` 唯一、`version`、內嵌歷程)。**沒有筆 = 期初建檔進行中**;`closedAt` 有值 = 已結束,
 * 不能再期初建檔(只能期初更正);重新開啟清掉 `closedAt` 並寫歷程。
 *
 * - `version`:結束 / 重新開啟、每次期初建檔都 `$inc`,讓「結束」與「建檔」一定有先後
 */
@Schema({ collection: LOTTERY_STORE_OPENINGS_COLLECTION, timestamps: true })
export class LotteryStoreOpening {
  /** 分店。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 期初建檔結束的時間;null = 進行中(或重新開啟後)。 */
  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  /** 按結束的人。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  closedBy!: Types.ObjectId | null;

  /** 結束 / 重新開啟歷程。 */
  @Prop({
    type: [
      {
        _id: false,
        action: { type: String, enum: STORE_OPENING_ACTIONS, required: true },
        at: { type: Date, required: true },
        by: { type: MongooseSchema.Types.ObjectId, required: true },
        reason: { type: String, default: null },
      },
    ],
    default: [],
  })
  history!: StoreOpeningHistoryEntry[];

  /** 結束 / 重新開啟 / 期初建檔都加 1(製造寫入衝突)。 */
  @Prop({ type: Number, default: 0 })
  version!: number;

  /** 模組 key(plugin 宣告;本表固定 `inventory`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryStoreOpeningSchema =
  SchemaFactory.createForClass(LotteryStoreOpening);

LotteryStoreOpeningSchema.index({ orgId: 1 }, { unique: true });
LotteryStoreOpeningSchema.plugin(baseFieldsPlugin);
LotteryStoreOpeningSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "private" },
});
LotteryStoreOpeningSchema.path("moduleKey").default(INVENTORY_MODULE_KEY);
