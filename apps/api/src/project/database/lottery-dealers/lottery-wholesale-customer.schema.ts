import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import {
  type ShareOrg,
  tenantScopePlugin,
} from "../../../database/plugins/tenant-scope.plugin";
import { DEALERS_MODULE_KEY } from "./lottery-dealer.schema";

export const LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION =
  "lottery_wholesale_customers";

/** 批售客戶狀態:往來中 / 停用(固定選項,不放欄位管理)。停用後不能再被新的批售單選,既有的單照常。 */
export const WHOLESALE_CUSTOMER_STATUSES = ["active", "inactive"] as const;
export type WholesaleCustomerStatus =
  (typeof WHOLESALE_CUSTOMER_STATUSES)[number];

/**
 * 批售客戶:向我們買整本的其他彩券行(專案規格 21.2;正本 `docs/modules/project/dealers.md`「資料」)。
 * 不是經銷商(甲類 / 乙類),所以不進 `lottery_dealers`:不算側欄計數、不寄提醒。
 * 屬經銷商管理模組(`moduleKey = dealers`);可見範圍同經銷商(`orgId` = 建立者當時的組織)。
 */
@Schema({
  collection: LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION,
  timestamps: true,
})
export class LotteryWholesaleCustomer {
  /** 所屬組織:建立者當時的組織(可見範圍,ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 店名(30 字內);可以重複,同名只提醒。 */
  @Prop({ type: String, required: true })
  storeName!: string;

  /** 證號:8 碼數字,選填;有填時租戶內唯一。 */
  @Prop({ type: String, default: null })
  licenseNo!: string | null;

  /** 聯絡人(10 字內)。 */
  @Prop({ type: String, default: null })
  contactName!: string | null;

  /** 電話(15 字內,只能數字)。 */
  @Prop({ type: String, default: null })
  phone!: string | null;

  /** 下拉顯示文字「店名 · 電話」(沒填電話只有店名):寫入時由店名、電話算好存著,給 lookup 來源用。 */
  @Prop({ type: String, required: true })
  label!: string;

  /** 地址(60 字內)。 */
  @Prop({ type: String, default: null })
  address!: string | null;

  /** 狀態(預設往來中)。 */
  @Prop({ type: String, enum: WHOLESALE_CUSTOMER_STATUSES, default: "active" })
  status!: WholesaleCustomerStatus;

  /** 備註(1000 字內)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `dealers`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;

  /** 共用給(plugin 宣告的共用清單;預設不共用,有 `dealers.wholesale-customers.edit` 的人設定)。 */
  shareOrgs!: ShareOrg[];
}

export const LotteryWholesaleCustomerSchema = SchemaFactory.createForClass(
  LotteryWholesaleCustomer,
);

LotteryWholesaleCustomerSchema.index({ orgId: 1, createdAt: 1 });
// 同名提醒以整個租戶查店名(店名可以重複,不是唯一索引)
LotteryWholesaleCustomerSchema.index({ tenantId: 1, storeName: 1 });
// 證號有填時租戶內唯一(沒填的、已軟刪除的不算)
LotteryWholesaleCustomerSchema.index(
  { tenantId: 1, licenseNo: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: { $type: "null" },
      licenseNo: { $type: "string" },
    },
  },
);
LotteryWholesaleCustomerSchema.plugin(baseFieldsPlugin);
// 可共用、預設不共用、可編輯(ADR-0014);名稱類欄位可經租戶內引用名稱出口讀(看得到批售單就看得到客戶名稱)
LotteryWholesaleCustomerSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: {
    mode: "shareable",
    defaultShareOrgs: "none",
    editable: true,
  },
  refFields: ["label", "storeName", "phone", "status"],
});
LotteryWholesaleCustomerSchema.path("moduleKey").default(DEALERS_MODULE_KEY);
