import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

import { ShareOrgModel } from "../../../../sharing/share-org.model";
import { LotteryDealerUserRef } from "./lottery-dealer.model";

export enum LotteryWholesaleCustomerStatusEnum {
  ACTIVE = "active",
  INACTIVE = "inactive",
}
registerEnumType(LotteryWholesaleCustomerStatusEnum, {
  name: "LotteryWholesaleCustomerStatus",
  description: "批售客戶狀態:往來中 / 停用",
});

@ObjectType()
export class LotteryWholesaleCustomerAbilities {
  /** 持有 `dealers.wholesale-customers.edit` 且不是共用進來的(已含權限判斷):[編輯]、[刪除]。 */
  @Field(() => Boolean)
  canEdit!: boolean;
}

/** 批售客戶(欄位語意正本 `docs/modules/project/dealers.md`「api 介面」)。 */
@ObjectType("LotteryWholesaleCustomer")
export class LotteryWholesaleCustomerModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  storeName!: string;

  @Field(() => String, { nullable: true })
  licenseNo!: string | null;

  @Field(() => String, { nullable: true })
  contactName!: string | null;

  @Field(() => String, { nullable: true })
  phone!: string | null;

  @Field(() => String, { nullable: true })
  address!: string | null;

  @Field(() => LotteryWholesaleCustomerStatusEnum)
  status!: LotteryWholesaleCustomerStatusEnum;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** 最近一次批售日:這位客戶已完成批售單的最新出貨時間(讀取時算);`null` = 無紀錄。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastWholesaleAt!: Date | null;

  @Field(() => LotteryDealerUserRef, { nullable: true })
  createdBy!: LotteryDealerUserRef | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  /** 最後修改者(`updatedBy`;系統資訊區塊)。 */
  @Field(() => LotteryDealerUserRef, { nullable: true })
  updatedBy!: LotteryDealerUserRef | null;

  /** 所屬組織(`orgId` = 建立者當時的組織)的名稱;以租戶的組織樹讀,找不到為 null。 */
  @Field(() => String, { nullable: true })
  ownerOrgName!: string | null;

  /** 共用給(ADR-0014;空 = 不共用)。 */
  @Field(() => [ShareOrgModel])
  shareOrgs!: ShareOrgModel[];

  /** 共用進來的(歸屬組織不在讀者的可見範圍):只能看。 */
  @Field(() => Boolean)
  isShared!: boolean;

  @Field(() => LotteryWholesaleCustomerAbilities)
  abilities!: LotteryWholesaleCustomerAbilities;
}

@ObjectType()
export class LotteryWholesaleCustomersPayload {
  @Field(() => [LotteryWholesaleCustomerModel])
  items!: LotteryWholesaleCustomerModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class LotteryWholesaleCustomerPayload {
  @Field(() => LotteryWholesaleCustomerModel)
  item!: LotteryWholesaleCustomerModel;
}

/** 同名的批售客戶(只給提醒用的店名與電話;可能是操作者看不到的那一筆)。 */
@ObjectType()
export class LotteryWholesaleCustomerSameName {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  storeName!: string;

  @Field(() => String, { nullable: true })
  phone!: string | null;
}

@ObjectType()
export class LotteryWholesaleCustomerSameNamesPayload {
  @Field(() => [LotteryWholesaleCustomerSameName])
  items!: LotteryWholesaleCustomerSameName[];

  @Field(() => Int)
  totalCount!: number;
}

@ObjectType()
export class DeleteLotteryWholesaleCustomerPayload {
  @Field(() => Boolean)
  success!: boolean;

  @Field(() => ID)
  deletedId!: string;
}
