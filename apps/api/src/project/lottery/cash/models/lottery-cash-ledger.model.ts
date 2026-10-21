import {
  Field,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { LotteryAccountsRefModel } from "../../accounts/models/lottery-bank-account.model";

/** 現金流水(只新增;`reversedById` 有值 = 已被沖正)。 */
@ObjectType("LotteryCashMovement")
export class LotteryCashMovementModel {
  @Field(() => ID)
  id!: string;

  @Field(() => LotteryAccountsRefModel)
  org!: LotteryAccountsRefModel;

  @Field(() => GraphQLISODateTime)
  occurredAt!: Date;

  @Field(() => String)
  type!: string;

  /** `drawer` / `vault` / `bank` / `external`。 */
  @Field(() => String)
  from!: string;

  @Field(() => String)
  to!: string;

  /** 出庫的原因:`opening_float` / `change` / `other`。 */
  @Field(() => String, { nullable: true })
  reason!: string | null;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  cashPoint!: LotteryAccountsRefModel | null;

  @Field(() => Int)
  amount!: number;

  @Field(() => String, { nullable: true })
  payee!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** 指回的單據(模組 key + 提交 id);前端依模組 key 組出單據的網址。 */
  @Field(() => String, { nullable: true })
  refType!: string | null;

  @Field(() => ID, { nullable: true })
  refId!: string | null;

  @Field(() => ID, { nullable: true })
  reversalOf!: string | null;

  @Field(() => ID, { nullable: true })
  reversedById!: string | null;

  @Field(() => LotteryAccountsRefModel, { nullable: true })
  createdBy!: LotteryAccountsRefModel | null;
}

/** 小金庫目前的應有金額(只從流水算)與起算點。 */
@ObjectType("LotteryVaultExpected")
export class LotteryVaultExpectedModel {
  @Field(() => Int)
  amount!: number;

  /** 起算點的清點金額(沒有日結 = 0)。 */
  @Field(() => Int)
  baselineAmount!: number;

  /** 起算點(最近一次已完成日結的時間);null = 從頭算。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  baselineAt!: Date | null;
}

/** 一個開著班的收銀點抽屜目前的應有金額(店面的收銀班次登記;沒開班的收銀點不列)。 */
@ObjectType("LotteryDrawerExpected")
export class LotteryDrawerExpectedModel {
  @Field(() => LotteryAccountsRefModel)
  cashPoint!: LotteryAccountsRefModel;

  @Field(() => ID)
  shiftId!: string;

  /** 負責人。 */
  @Field(() => LotteryAccountsRefModel)
  openedBy!: LotteryAccountsRefModel;

  @Field(() => GraphQLISODateTime)
  openedAt!: Date;

  @Field(() => Int)
  amount!: number;
}

@ObjectType()
export class LotteryCashLedgerPayload {
  @Field(() => LotteryVaultExpectedModel)
  vault!: LotteryVaultExpectedModel;

  /** 各收銀點抽屜的應有(開著的班,依收銀點排序)。 */
  @Field(() => [LotteryDrawerExpectedModel])
  drawers!: LotteryDrawerExpectedModel[];

  @Field(() => [LotteryCashMovementModel])
  items!: LotteryCashMovementModel[];

  @Field(() => Int)
  totalCount!: number;
}

@ObjectType()
export class LotteryCashMovementPayload {
  @Field(() => LotteryCashMovementModel)
  item!: LotteryCashMovementModel;
}

/** 即時現金帳(只能查看):分店必填(可見範圍內);期間 / 類型 / 收銀點缺席 = 不篩。 */
@InputType()
export class LotteryCashLedgerInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  from?: Date | null;

  /** 不含(`occurredAt < to`)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  to?: Date | null;

  @Field(() => String, { nullable: true })
  type?: string | null;

  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;
}
