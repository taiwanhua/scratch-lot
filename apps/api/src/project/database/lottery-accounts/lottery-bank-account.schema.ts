import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import {
  ACCOUNTS_KEY,
  BANK_ACCOUNT_STATUS,
  BANK_ACCOUNT_STATUSES,
  type BankAccountStatus,
} from "@repo/domain/project/lottery-accounts";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import {
  type ShareOrg,
  tenantScopePlugin,
} from "../../../database/plugins/tenant-scope.plugin";

export const LOTTERY_BANK_ACCOUNTS_COLLECTION = "lottery_bank_accounts";

/**
 * 銀行帳戶(專案規格 10.1;欄位規則正本 `docs/modules/project/accounts.md`「資料」)。
 *
 * - **使用組織 = 資料共用的 `shareOrgs`**(可共用、預設不共用、可編輯;ADR-0014):分店的人看得到
 *   使用組織包含自己的帳戶(全部分店 = 租戶頂層含下層);總部照可見範圍看得到全部。不另建關聯表
 * - 餘額不存:由交易即時加總(`lottery_bank_transactions`)
 * - 有交易之後期初餘額、期初日期鎖定;沒有交易才能刪除(軟刪除),有交易只能停用
 */
@Schema({ collection: LOTTERY_BANK_ACCOUNTS_COLLECTION, timestamps: true })
export class LotteryBankAccount {
  /** 建立時的當前組織(總部;修改 / 刪除照它的可見範圍)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 銀行代碼(3 碼數字)。 */
  @Prop({ type: String, required: true })
  bankCode!: string;

  /** 分行名稱(30 字內;選填)。 */
  @Prop({ type: String, default: null })
  branchName!: string | null;

  /** 帳號(30 字內);`(tenantId, bankCode, accountNo)` 唯一。 */
  @Prop({ type: String, required: true })
  accountNo!: string;

  /** 戶名(50 字內)。 */
  @Prop({ type: String, required: true })
  accountName!: string;

  /** 選單顯示名稱 = 戶名 + 帳號末 5 碼(api 依戶名、帳號算後存;lookup 的顯示欄)。 */
  @Prop({ type: String, required: true })
  label!: string;

  /** 期初餘額(整數元,可為負);有交易之後鎖定。 */
  @Prop({ type: Number, required: true })
  openingBalance!: number;

  /** 期初日期(時點:租戶時區那一天 00:00);有交易之後鎖定。 */
  @Prop({ type: Date, required: true })
  openingDate!: Date;

  /** 狀態:使用中 / 停用(停用的不出現在 lookup)。 */
  @Prop({
    type: String,
    enum: BANK_ACCOUNT_STATUSES,
    default: BANK_ACCOUNT_STATUS.active,
  })
  status!: BankAccountStatus;

  /** 備註(1000 字內)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `accounts`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告;`BaseRepository.create` 推導,根組織為 null)。 */
  tenantId!: Types.ObjectId | null;

  /** 使用組織(plugin 宣告的共用清單;預設不共用,有 `accounts.edit-bank-account` 的人設定)。 */
  shareOrgs!: ShareOrg[];
}

export const LotteryBankAccountSchema =
  SchemaFactory.createForClass(LotteryBankAccount);

LotteryBankAccountSchema.index({ orgId: 1, createdAt: 1 });
// 銀行代碼 + 帳號在租戶內唯一(已軟刪除的不算)
LotteryBankAccountSchema.index(
  { tenantId: 1, bankCode: 1, accountNo: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryBankAccountSchema.plugin(baseFieldsPlugin);
// 可共用、預設不共用、可編輯(ADR-0014):共用清單就是「使用組織」;選單名稱可經租戶內引用名稱出口讀
LotteryBankAccountSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  sharing: {
    mode: "shareable",
    defaultShareOrgs: "none",
    editable: true,
  },
  refFields: ["label", "accountName"],
});
LotteryBankAccountSchema.path("moduleKey").default(ACCOUNTS_KEY);
