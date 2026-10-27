import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

/** collection 名(單號計數器)。 */
export const SERIAL_COUNTERS_COLLECTION = "serial_counters";

/**
 * **單號計數器**(`docs/data-model.md`「serial_counters」):每個租戶、每種單號、每個期間一筆,
 * `seq` = 已給出的最後一號。唯一 `(tenantId, key, period)`;取號以 `findOneAndUpdate` 的 `$inc` + upsert
 * 原子完成(同時取號不重複、連號),可在交易內(交易回復 = 這次取的號也回復)。
 *
 * 不是業務資料:沒有組織歸屬與操作者,不掛基礎欄位與租戶 plugin;只經 `SerialCountersStore` 讀寫,
 * 每次讀寫都明給 `tenantId`(根組織自己的資料為 null)。
 */
@Schema({
  collection: SERIAL_COUNTERS_COLLECTION,
  timestamps: true,
  versionKey: false,
})
export class SerialCounter {
  /** 租戶頂層 id(根組織自己的資料為 null)。 */
  @Prop({ type: Types.ObjectId, default: null })
  tenantId!: Types.ObjectId | null;

  /** 哪一種單號(表單:`form:<formKey>`;其他資料由呼叫端自取,例 `purchase-order`)。 */
  @Prop({ type: String, required: true })
  key!: string;

  /** 期間鍵(`@repo/domain/form` 的 `serialPeriodKeyOf`):`none` / `2026` / `202610`。 */
  @Prop({ type: String, required: true })
  period!: string;

  /** 已給出的最後一號(第一號 = 1)。 */
  @Prop({ type: Number, required: true, default: 0 })
  seq!: number;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const SerialCounterSchema = SchemaFactory.createForClass(SerialCounter);

// 每個租戶、每種單號、每個期間只有一個計數器:upsert 同時到也只會建一筆
SerialCounterSchema.index({ tenantId: 1, key: 1, period: 1 }, { unique: true });
