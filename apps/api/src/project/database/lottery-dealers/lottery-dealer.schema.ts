import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_DEALERS_COLLECTION = "lottery_dealers";

/** 本表固定屬於經銷商管理(`tenantScopePlugin` 的 `moduleData`)。 */
export const DEALERS_MODULE_KEY = "dealers";

/** 經銷商類型:甲類 / 乙類(建立後唯讀)。 */
export const DEALER_TYPES = ["a", "b"] as const;
export type DealerType = (typeof DEALER_TYPES)[number];

/** 經銷商狀態:營業中 / 暫停 / 解約(固定選項,不放欄位管理)。 */
export const DEALER_STATUSES = ["active", "suspended", "terminated"] as const;
export type DealerStatus = (typeof DEALER_STATUSES)[number];

/** 牌租週期:月 / 季 / 年。 */
export const RENT_CYCLES = ["month", "quarter", "year"] as const;
export type RentCycle = (typeof RENT_CYCLES)[number];

/**
 * 經銷商(專案規格 5.2;欄位規則正本 `docs/modules/project/dealers.md`「資料」)。
 * 日期欄一律是時點:admin 以租戶時區那一天 00:00 送(`lib/base/form-engine/local-day.ts`)。
 * 甲類才有的欄位(批購日)、乙類才有的欄位(店面、牌租)在另一類一律為 null。
 */
@Schema({ collection: LOTTERY_DEALERS_COLLECTION, timestamps: true })
export class LotteryDealer {
  /** 建立者當時的組織(可見範圍,ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 類型(甲類 `a` / 乙類 `b`);建立後唯讀。 */
  @Prop({ type: String, enum: DEALER_TYPES, required: true })
  type!: DealerType;

  /** 證號:8 碼數字,租戶內唯一(service 檢查 + 部分唯一索引)。 */
  @Prop({ type: String, required: true })
  licenseNo!: string;

  /** 姓名(10 字內)。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 狀態;解約的不能再被選取、不算側欄計數、不寄提醒。 */
  @Prop({ type: String, enum: DEALER_STATUSES, default: "active" })
  status!: DealerStatus;

  /** 證照核准日。 */
  @Prop({ type: Date, required: true })
  licenseApprovedAt!: Date;

  /** 證照到期日:到期前 30 天警告、過期錯誤;側欄計數與「證照到期」提醒依它。 */
  @Prop({ type: Date, required: true })
  licenseExpiresAt!: Date;

  /** 甲類:最近一次批購基準日(上線前最後一次批購);欄位級權限 `show-` / `edit-last-purchase-base-date`。 */
  @Prop({ type: Date, default: null })
  lastPurchaseBaseDate!: Date | null;

  /** 甲類:最近一次本人批購基準日;欄位級權限 `show-` / `edit-last-self-purchase-base-date`。 */
  @Prop({ type: Date, default: null })
  lastSelfPurchaseBaseDate!: Date | null;

  /**
   * 甲類:最近一次批購日 = max(基準日, 有效進貨單上最新的批購日期);由
   * `lottery/dealers/purchase-dates.ts` 的 `recomputeDealerPurchaseDates` 寫,不從 input 收。
   */
  @Prop({ type: Date, default: null })
  lastPurchaseDate!: Date | null;

  /** 甲類:最近一次本人批購日(同上)。 */
  @Prop({ type: Date, default: null })
  lastSelfPurchaseDate!: Date | null;

  /** 乙類:店名(30 字內)。 */
  @Prop({ type: String, default: null })
  storeName!: string | null;

  /** 乙類:營業地址(60 字內)。 */
  @Prop({ type: String, default: null })
  businessAddress!: string | null;

  /** 乙類:店面電話(15 字內,只能數字)。 */
  @Prop({ type: String, default: null })
  storePhone!: string | null;

  /** 乙類:終端機編號(20 字內)。 */
  @Prop({ type: String, default: null })
  terminalNo!: string | null;

  /** 乙類:牌租費用(整數元)。 */
  @Prop({ type: Number, default: null })
  rentFee!: number | null;

  /** 乙類:牌租週期。 */
  @Prop({ type: String, enum: [...RENT_CYCLES, null], default: null })
  rentCycle!: RentCycle | null;

  /** 乙類:起算月份(1–12);週期是季 / 年時必填,月為 null。 */
  @Prop({ type: Number, default: null })
  rentStartMonth!: number | null;

  /** 乙類:繳費日(每期第一個月的第幾日,1–31;那個月沒有這一天就用月底)。 */
  @Prop({ type: Number, default: null })
  rentDueDay!: number | null;

  /** 身分證字號:1 英文字母 + 9 碼數字,租戶內經銷商之間唯一。 */
  @Prop({ type: String, required: true })
  nationalId!: string;

  /** 生日。 */
  @Prop({ type: Date, default: null })
  birthday!: Date | null;

  /** 電話(15 字內,只能數字)。 */
  @Prop({ type: String, default: null })
  phone!: string | null;

  /** 手機(15 字內,只能數字)。 */
  @Prop({ type: String, default: null })
  mobile!: string | null;

  /** email(60 字內)。 */
  @Prop({ type: String, default: null })
  email!: string | null;

  /** 通訊地址(60 字內)。 */
  @Prop({ type: String, default: null })
  mailingAddress!: string | null;

  /** 戶籍地址(60 字內);「同通訊地址」時存通訊地址的值。 */
  @Prop({ type: String, default: null })
  residentialAddress!: string | null;

  /** 戶籍地址同通訊地址(畫面勾選)。 */
  @Prop({ type: Boolean, default: false })
  residentialSameAsMailing!: boolean;

  /** 備註(1000 字內)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `dealers`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告;`BaseRepository.create` 推導,根組織為 null)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryDealerSchema = SchemaFactory.createForClass(LotteryDealer);

LotteryDealerSchema.index({ orgId: 1, createdAt: 1 });
// 證號、身分證字號在租戶內唯一(已軟刪除的不算)
LotteryDealerSchema.index(
  { tenantId: 1, licenseNo: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryDealerSchema.index(
  { tenantId: 1, nationalId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryDealerSchema.plugin(baseFieldsPlugin);
LotteryDealerSchema.plugin(tenantScopePlugin, { moduleData: true });
LotteryDealerSchema.path("moduleKey").default(DEALERS_MODULE_KEY);
