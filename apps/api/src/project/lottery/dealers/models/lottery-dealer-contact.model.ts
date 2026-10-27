import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import {
  LotteryContactRoleEnum,
  LotteryContactStatusEnum,
  LotteryDealerRef,
  LotteryDealerUserRef,
} from "./lottery-dealer.model";

@ObjectType()
export class LotteryDealerContactAbilities {
  /** 持有 `dealers.contacts.edit`(已含權限判斷,前端直接用)。 */
  @Field(() => Boolean)
  canEdit!: boolean;
}

/** 關係人的一筆關聯(關聯的經銷商 + 身分)。 */
@ObjectType()
export class LotteryDealerContactLink {
  @Field(() => LotteryDealerRef)
  dealer!: LotteryDealerRef;

  @Field(() => LotteryContactRoleEnum)
  role!: LotteryContactRoleEnum;
}

/** 關係人(欄位語意正本 `docs/modules/project/dealers.md`「api 介面」)。 */
@ObjectType("LotteryDealerContact")
export class LotteryDealerContactModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => [LotteryContactRoleEnum])
  roles!: LotteryContactRoleEnum[];

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

  @Field(() => LotteryContactStatusEnum)
  status!: LotteryContactStatusEnum;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** 關聯經銷商數(同一位經銷商多種身分算一位)。 */
  @Field(() => Int)
  dealerCount!: number;

  /** 關聯的經銷商與身分(一筆關聯一列)。 */
  @Field(() => [LotteryDealerContactLink])
  links!: LotteryDealerContactLink[];

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

  @Field(() => LotteryDealerContactAbilities)
  abilities!: LotteryDealerContactAbilities;
}

@ObjectType()
export class LotteryDealerContactsPayload {
  @Field(() => [LotteryDealerContactModel])
  items!: LotteryDealerContactModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class LotteryDealerContactPayload {
  @Field(() => LotteryDealerContactModel)
  item!: LotteryDealerContactModel;
}
