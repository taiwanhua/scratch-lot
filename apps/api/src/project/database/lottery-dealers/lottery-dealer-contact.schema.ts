import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { DEALERS_MODULE_KEY } from "./lottery-dealer.schema";

export const LOTTERY_DEALER_CONTACTS_COLLECTION = "lottery_dealer_contacts";

/** 關係人的身分(固定選項,不放欄位管理);也是關聯 `lottery_dealer_lottery_dealer_contact` 的 `meta.role`。 */
export const CONTACT_ROLES = ["trustee", "agent", "introducer"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/** 關係人狀態:啟用 / 停用。停用後既有關聯保留,不能再被選取。 */
export const CONTACT_STATUSES = ["active", "disabled"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/**
 * 關係人:受託人、代理人、介紹人的總稱(專案規格 5.3;正本 `docs/modules/project/dealers.md`「資料」)。
 * 屬經銷商管理模組(`moduleKey = dealers`);可見範圍同經銷商(`orgId` = 建立者當時的組織)。
 */
@Schema({ collection: LOTTERY_DEALER_CONTACTS_COLLECTION, timestamps: true })
export class LotteryDealerContact {
  /** 建立者當時的組織(可見範圍,ADR-0005)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 姓名(10 字內)。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 身分(多選,至少一個)。 */
  @Prop({ type: [String], enum: CONTACT_ROLES, required: true })
  roles!: ContactRole[];

  /** 身分證字號:1 英文字母 + 9 碼數字,租戶內關係人之間唯一。 */
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

  /** 戶籍地址(60 字內)。 */
  @Prop({ type: String, default: null })
  residentialAddress!: string | null;

  /** 戶籍地址同通訊地址。 */
  @Prop({ type: Boolean, default: false })
  residentialSameAsMailing!: boolean;

  /** 狀態(預設啟用)。 */
  @Prop({ type: String, enum: CONTACT_STATUSES, default: "active" })
  status!: ContactStatus;

  /** 備註(1000 字內)。 */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** 模組 key(plugin 宣告;本表固定 `dealers`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(plugin 宣告)。 */
  tenantId!: Types.ObjectId | null;
}

export const LotteryDealerContactSchema =
  SchemaFactory.createForClass(LotteryDealerContact);

LotteryDealerContactSchema.index({ orgId: 1, createdAt: 1 });
LotteryDealerContactSchema.index(
  { tenantId: 1, nationalId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } },
);
LotteryDealerContactSchema.plugin(baseFieldsPlugin);
// 名稱與關聯檢查要的欄位可經租戶內引用名稱出口讀(看得到經銷商就看得到它關聯的關係人名稱)。
// `nationalId` / `roles` 只供 service 內部比對(本人不能登記成自己的關係人、身分是否相符),
// **不得回傳前端**:對外只回 `name` / `status`(`dealer-view.service.ts` 的關係人參照)
LotteryDealerContactSchema.plugin(tenantScopePlugin, {
  moduleData: true,
  refFields: ["name", "status", "nationalId", "roles"],
});
LotteryDealerContactSchema.path("moduleKey").default(DEALERS_MODULE_KEY);
