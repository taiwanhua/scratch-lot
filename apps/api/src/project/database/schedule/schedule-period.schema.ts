import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_PERIOD_STATUSES } from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MANAGE_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_PERIODS_COLLECTION = "schedule_periods";

/**
 * 某家店某個月的排班狀態(規格 14.1 `schedule_periods`):未發布 / 已發布(只會從未發布變成已發布;
 * 沒有取消發布)。這個月第一次寫入人力需求或排班時建立(未發布)。
 *
 * - `version`:這家店這個月的人力需求 / 排班寫入在交易一開始 `$inc`,同時送出的寫入互相衝突、
 *   由 `TransactionService` 重跑(先例:畫休的守門文件)
 * - 自動排班的鎖定(`lockedAt` / `lockedBy`)與發布(`publishedAt` / `publishedBy`)由各自的功能寫
 */
@Schema({ collection: SCHEDULE_PERIODS_COLLECTION, timestamps: true })
export class SchedulePeriod {
  /** 分店(歸屬組織)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 月份 `YYYY-MM`。 */
  @Prop({ type: String, required: true })
  month!: string;

  /** `unpublished` 未發布 / `published` 已發布。 */
  @Prop({
    type: String,
    enum: [...SCHEDULE_PERIOD_STATUSES],
    default: "unpublished",
  })
  status!: string;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  publishedBy!: Types.ObjectId | null;

  /** 自動排班執行中的鎖定時點(10 分鐘逾時自動解除)。 */
  @Prop({ type: Date, default: null })
  lockedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  lockedBy!: Types.ObjectId | null;

  /** 每次寫入人力需求 / 排班加 1(只用來製造寫入衝突)。 */
  @Prop({ type: Number, default: 0 })
  version!: number;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const SchedulePeriodSchema =
  SchemaFactory.createForClass(SchedulePeriod);

SchedulePeriodSchema.index(
  { orgId: 1, month: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: { $type: "null" } },
    name: "unique_period_per_org_month",
  },
);
SchedulePeriodSchema.plugin(baseFieldsPlugin);
SchedulePeriodSchema.plugin(tenantScopePlugin, { moduleData: true });
SchedulePeriodSchema.path("moduleKey").default(SCHEDULE_MANAGE_MODULE_KEY);
