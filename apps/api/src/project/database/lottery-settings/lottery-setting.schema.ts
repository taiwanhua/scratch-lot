import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { LOTTERY_SETTINGS_KEY } from "@repo/domain/project/lottery-settings";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_SETTINGS_COLLECTION = "lottery_settings";

/**
 * 刮刮樂設定(張數店規格第 4 節、5.5;整張照抄排班的 `schedule_settings`):一列 = 某組織對某條設定的**自訂**。
 * 沒有列 = 沿用;生效值沿組織樹往上找(分店 → 區域 → 最上層組織),最後用程式預設
 * (`@repo/domain/project/lottery-settings` 的定義)。
 *
 * - 唯一 `(orgId, key)`(只算未刪除的,partial index);[還原] = 軟刪除
 * - `value` 一律 `{ option: string }`(這批設定都是「從幾個選項選一個」)
 * - `enabled` / `level` / `order` 照抄排班的形狀,這批設定固定 true / null / 0
 */
@Schema({ collection: LOTTERY_SETTINGS_COLLECTION, timestamps: true })
export class LotterySetting {
  /** 自訂這條設定的組織。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 設定的 key(定義清單裡的一個,例 `count_mode`)。 */
  @Prop({ type: String, required: true })
  key!: string;

  /** 開關(照抄排班的形狀;這批設定固定 true)。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 值:`{ option }`(選項見定義)。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  value!: Record<string, unknown>;

  /** 等級(照抄排班的形狀;這批設定沒有等級,固定 null)。 */
  @Prop({ type: String, default: null })
  level!: string | null;

  /** 排序(照抄排班的形狀;固定 0)。 */
  @Prop({ type: Number, default: 0 })
  order!: number;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const LotterySettingSchema =
  SchemaFactory.createForClass(LotterySetting);

// 某組織某條設定只有一筆未刪除的自訂;[還原] 軟刪除後可以再自訂
LotterySettingSchema.index(
  { orgId: 1, key: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotterySettingSchema.index({ orgId: 1, createdAt: 1 });
// 上層改預設時重算下層分店:一次讀整個租戶的這條設定
LotterySettingSchema.index({ tenantId: 1, key: 1 });
LotterySettingSchema.plugin(baseFieldsPlugin);
// 上層沿用到下層(ADR-0014):下層看得到所屬組織上層鏈建的;修改 / 刪除只在自己可見範圍內
LotterySettingSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: { mode: "inheritDown" },
});
LotterySettingSchema.path("moduleKey").default(LOTTERY_SETTINGS_KEY);
