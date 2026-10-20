import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

/** 經銷商類型(成員值即落庫的字串)。 */
export enum LotteryDealerTypeEnum {
  A = "a",
  B = "b",
}
registerEnumType(LotteryDealerTypeEnum, {
  name: "LotteryDealerType",
  description: "經銷商類型:甲類 A / 乙類 B(建立後唯讀)",
});

export enum LotteryDealerStatusEnum {
  ACTIVE = "active",
  SUSPENDED = "suspended",
  TERMINATED = "terminated",
}
registerEnumType(LotteryDealerStatusEnum, {
  name: "LotteryDealerStatus",
  description: "經銷商狀態:營業中 / 暫停 / 解約",
});

export enum LotteryRentCycleEnum {
  MONTH = "month",
  QUARTER = "quarter",
  YEAR = "year",
}
registerEnumType(LotteryRentCycleEnum, {
  name: "LotteryRentCycle",
  description: "牌租週期:月 / 季 / 年",
});

export enum LotteryContactRoleEnum {
  TRUSTEE = "trustee",
  AGENT = "agent",
  INTRODUCER = "introducer",
}
registerEnumType(LotteryContactRoleEnum, {
  name: "LotteryContactRole",
  description: "關係人的身分:受託人 / 代理人 / 介紹人",
});

export enum LotteryContactStatusEnum {
  ACTIVE = "active",
  DISABLED = "disabled",
}
registerEnumType(LotteryContactStatusEnum, {
  name: "LotteryContactStatus",
  description: "關係人狀態:啟用 / 停用",
});

export enum LotteryLicenseStateEnum {
  OK = "ok",
  EXPIRING = "expiring",
  EXPIRED = "expired",
}
registerEnumType(LotteryLicenseStateEnum, {
  name: "LotteryLicenseState",
  description: "證照狀態(租戶時區的今天):正常 / 30 天內到期(含當天)/ 已過期",
});

export enum LotterySigninStateEnum {
  SIGNED = "signed",
  MISSING = "missing",
  OPEN = "open",
  NOT_STARTED = "not_started",
}
registerEnumType(LotterySigninStateEnum, {
  name: "LotterySigninState",
  description:
    "見簽季別的狀態:已見簽 / 已過沒登記(警告)/ 本季還沒登記 / 未到(停用)",
});

@ObjectType()
export class LotteryDealerUserRef {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

@ObjectType()
export class LotteryDealerOrgRef {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/** 經銷商的最小參照(共同銷售處所、關係人的關聯經銷商)。 */
@ObjectType()
export class LotteryDealerRef {
  @Field(() => ID)
  id!: string;

  @Field(() => LotteryDealerTypeEnum)
  type!: LotteryDealerTypeEnum;

  @Field(() => String)
  licenseNo!: string;

  @Field(() => String)
  name!: string;

  /** 乙類的店名;甲類 null。 */
  @Field(() => String, { nullable: true })
  storeName!: string | null;

  @Field(() => LotteryDealerStatusEnum)
  status!: LotteryDealerStatusEnum;
}

/** 關係人的最小參照(經銷商的代理人 / 受託人 / 介紹人)。 */
@ObjectType()
export class LotteryDealerContactRef {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => LotteryContactStatusEnum)
  status!: LotteryContactStatusEnum;
}

/** 這位操作者對這一筆能做什麼(**已含權限判斷**,前端直接用,GQL-07)。 */
@ObjectType()
export class LotteryDealerAbilities {
  /** 持有 `dealers.edit`:[編輯]、[登記見簽]。 */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 甲類且持有 `dealers.edit-last-purchase-base-date`。 */
  @Field(() => Boolean)
  canEditLastPurchaseBaseDate!: boolean;

  /** 甲類且持有 `dealers.edit-last-self-purchase-base-date`。 */
  @Field(() => Boolean)
  canEditLastSelfPurchaseBaseDate!: boolean;
}

/**
 * 經銷商(欄位語意正本 `docs/modules/project/dealers.md`「api 介面」)。
 * 日期欄是時點(租戶時區那一天 00:00)。另一類才有的欄位一律 null。
 */
@ObjectType("LotteryDealer")
export class LotteryDealerModel {
  @Field(() => ID)
  id!: string;

  @Field(() => LotteryDealerTypeEnum)
  type!: LotteryDealerTypeEnum;

  @Field(() => String)
  licenseNo!: string;

  @Field(() => String)
  name!: string;

  @Field(() => LotteryDealerStatusEnum)
  status!: LotteryDealerStatusEnum;

  @Field(() => GraphQLISODateTime)
  licenseApprovedAt!: Date;

  @Field(() => GraphQLISODateTime)
  licenseExpiresAt!: Date;

  /** 證照狀態(租戶時區的今天)。 */
  @Field(() => LotteryLicenseStateEnum)
  licenseState!: LotteryLicenseStateEnum;

  /** 甲類:共同銷售處所(乙類)。 */
  @Field(() => LotteryDealerRef, { nullable: true })
  coSalesDealer!: LotteryDealerRef | null;

  @Field(() => [LotteryDealerContactRef])
  agents!: LotteryDealerContactRef[];

  @Field(() => [LotteryDealerContactRef])
  trustees!: LotteryDealerContactRef[];

  @Field(() => [LotteryDealerContactRef])
  introducers!: LotteryDealerContactRef[];

  /**
   * 甲類:最近一次批購基準日。**沒有 `dealers.show-last-purchase-base-date` 時回 null**
   * (api 不放進回傳物件);前端依自己的權限集決定顯示與否,不拿值猜權限。
   */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastPurchaseBaseDate?: Date | null;

  /** 甲類:最近一次本人批購基準日;沒有 `show-last-self-purchase-base-date` 時回 null(同上)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastSelfPurchaseBaseDate?: Date | null;

  /** 甲類:最近一次批購日(顯示值 = max(基準日, 有效進貨單的批購日));null = 無紀錄。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastPurchaseDate!: Date | null;

  /** 甲類:最近一次本人批購日;null = 無紀錄。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastSelfPurchaseDate!: Date | null;

  /** 甲類:距最近一次批購幾天(租戶時區的今天);無紀錄 null。 */
  @Field(() => Int, { nullable: true })
  daysSinceLastPurchase!: number | null;

  /** 甲類:距最近一次本人批購幾天;無紀錄 null。 */
  @Field(() => Int, { nullable: true })
  daysSinceLastSelfPurchase!: number | null;

  /** 甲類:本季已見簽;乙類 null。 */
  @Field(() => Boolean, { nullable: true })
  currentQuarterSigned!: boolean | null;

  /** 乙類:對應分店(`org_lottery_dealer`);未選 null。 */
  @Field(() => LotteryDealerOrgRef, { nullable: true })
  storeOrg!: LotteryDealerOrgRef | null;

  @Field(() => String, { nullable: true })
  storeName!: string | null;

  @Field(() => String, { nullable: true })
  businessAddress!: string | null;

  @Field(() => String, { nullable: true })
  storePhone!: string | null;

  @Field(() => String, { nullable: true })
  terminalNo!: string | null;

  /** 乙類:共同銷售人數(反查 `lottery_dealer_lottery_dealer`;超過 6 只警告)。 */
  @Field(() => Int, { nullable: true })
  coSellerCount!: number | null;

  @Field(() => Int, { nullable: true })
  rentFee!: number | null;

  @Field(() => LotteryRentCycleEnum, { nullable: true })
  rentCycle!: LotteryRentCycleEnum | null;

  @Field(() => Int, { nullable: true })
  rentStartMonth!: number | null;

  @Field(() => Int, { nullable: true })
  rentDueDay!: number | null;

  /** 乙類:下一個繳費日(租戶時區的今天起算,含今天);沒設牌租 null。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  nextRentDueAt!: Date | null;

  @Field(() => String)
  nationalId!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  birthday!: Date | null;

  @Field(() => String, { nullable: true })
  phone!: string | null;

  @Field(() => String, { nullable: true })
  mobile!: string | null;

  @Field(() => String, { nullable: true })
  email!: string | null;

  @Field(() => String, { nullable: true })
  mailingAddress!: string | null;

  @Field(() => String, { nullable: true })
  residentialAddress!: string | null;

  @Field(() => Boolean)
  residentialSameAsMailing!: boolean;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => LotteryDealerUserRef, { nullable: true })
  createdBy!: LotteryDealerUserRef | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => LotteryDealerAbilities)
  abilities!: LotteryDealerAbilities;
}

@ObjectType()
export class LotteryDealersPayload {
  @Field(() => [LotteryDealerModel])
  items!: LotteryDealerModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class LotteryDealerPayload {
  @Field(() => LotteryDealerModel)
  item!: LotteryDealerModel;
}

/** 一季的見簽(沒登記的季別 `id` / `signedAt` 為 null)。 */
@ObjectType()
export class LotteryDealerSigninModel {
  @Field(() => ID, { nullable: true })
  id!: string | null;

  @Field(() => Int)
  year!: number;

  @Field(() => Int)
  quarter!: number;

  @Field(() => GraphQLISODateTime, { nullable: true })
  signedAt!: Date | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => LotterySigninStateEnum)
  state!: LotterySigninStateEnum;
}

/** 某年四季的見簽(一定四筆,Q1–Q4)。 */
@ObjectType()
export class LotteryDealerSigninsPayload {
  @Field(() => [LotteryDealerSigninModel])
  items!: LotteryDealerSigninModel[];

  @Field(() => Int)
  totalCount!: number;
}

@ObjectType()
export class LotteryDealerSigninPayload {
  @Field(() => LotteryDealerSigninModel)
  item!: LotteryDealerSigninModel;
}

/** 乙類的一位共同銷售人(甲類)與登記日(關聯建立時間)。 */
@ObjectType()
export class LotteryDealerCoSellerModel {
  @Field(() => LotteryDealerRef)
  dealer!: LotteryDealerRef;

  @Field(() => GraphQLISODateTime)
  registeredAt!: Date;
}

@ObjectType()
export class LotteryDealerCoSellersPayload {
  @Field(() => [LotteryDealerCoSellerModel])
  items!: LotteryDealerCoSellerModel[];

  @Field(() => Int)
  totalCount!: number;
}

/** 已對應乙類的分店(對應分店的組織樹上停用並註明原因)。 */
@ObjectType()
export class LotteryOccupiedStoreModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => LotteryDealerRef)
  dealer!: LotteryDealerRef;
}

@ObjectType()
export class LotteryOccupiedStoresPayload {
  @Field(() => [LotteryOccupiedStoreModel])
  items!: LotteryOccupiedStoreModel[];

  @Field(() => Int)
  totalCount!: number;
}
