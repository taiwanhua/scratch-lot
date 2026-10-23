import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { SCHEDULE_DAY_OFF_KINDS } from "@repo/domain/project/schedule-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_MY_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_DAY_OFFS_COLLECTION = "schedule_day_offs";

/**
 * 畫休(規格 14.1 `schedule_day_offs`、14.6):員工自己登記不排班的總稱,**屬於人**
 * (那段時間所有分店都不能排)。
 *
 * - `kind`:整天畫休 `full-day`(整天不可排的捷徑,一天一筆)/ 時段不可排 `time-range`
 *   (`startAt` / `endAt`,一天可以多段、不能重疊)
 * - `orgId`:歸屬組織 = 登記時的組織(本人登記 = 當前組織;代改 = 畫休總覽選的那家店),不共用;
 *   讀取以人為準(`tenantId` + `userId`),不看歸屬組織
 * - 代改:`by` 記代改人;截止後代改必填 `reason`(欄位管理「代改畫休原因」),選「其他」要填 `reasonNote`
 * - 唯一:同一人同一天只有一筆未刪除的整天畫休(partial index)
 * - 日期與時段都是時點(`docs/concepts/form-engine.md`「日期與日期時間都是時點」):`date` = 租戶時區那天 00:00
 */
@Schema({ collection: SCHEDULE_DAY_OFFS_COLLECTION, timestamps: true })
export class ScheduleDayOff {
  /** 歸屬組織(ADR-0005):本人登記 = 當前組織;代改 = 畫休總覽選的那家店。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 使用者 `users._id`。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 日期:租戶時區那天 00:00 的時點(入口用租戶時區正規化)。 */
  @Prop({ type: Date, required: true })
  date!: Date;

  /** 種類:整天畫休 `full-day` / 時段不可排 `time-range`(程式固定)。 */
  @Prop({ type: String, enum: [...SCHEDULE_DAY_OFF_KINDS], required: true })
  kind!: string;

  /** 時段不可排的開始(時點,落在 `date` 那天);整天畫休為 null。 */
  @Prop({ type: Date, default: null })
  startAt!: Date | null;

  /** 時段不可排的結束(時點,晚於開始;不跨午夜);整天畫休為 null。 */
  @Prop({ type: Date, default: null })
  endAt!: Date | null;

  /** 備註(選填)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 代改人(`users._id`);本人登記為 null。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  by!: Types.ObjectId | null;

  /** 代改原因(欄位管理「代改畫休原因」的選項 value);截止後代改必填,其他情況可空。 */
  @Prop({ type: String, default: null })
  reason!: string | null;

  /** 代改原因選「其他」時的說明。 */
  @Prop({ type: String, default: null })
  reasonNote!: string | null;

  /** 模組 key(固定 `schedule.my`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(`BaseRepository.create` 推導)。 */
  tenantId!: Types.ObjectId | null;
}

export const ScheduleDayOffSchema =
  SchemaFactory.createForClass(ScheduleDayOff);

// 同一人同一天只有一筆未刪除的整天畫休(規格 14.1);時段不可排可以多段(重疊由 service 擋)
ScheduleDayOffSchema.index(
  { tenantId: 1, userId: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: "full-day",
      deletedAt: { $type: "null" },
    },
    name: "unique_full_day_per_user_date",
  },
);
ScheduleDayOffSchema.index({ tenantId: 1, date: 1 });
ScheduleDayOffSchema.index({ orgId: 1, createdAt: 1 });
ScheduleDayOffSchema.plugin(baseFieldsPlugin);
ScheduleDayOffSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleDayOffSchema.path("moduleKey").default(SCHEDULE_MY_MODULE_KEY);
