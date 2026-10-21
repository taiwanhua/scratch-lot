import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 可以選的收銀班次(撤銷售出申請的退款班次;規格 8.5「只能選本店的班」)。 */
@ObjectType("LotteryStoreShiftOption")
export class LotteryStoreShiftOptionModel {
  @Field(() => ID)
  id!: string;

  /** `店內櫃台 · 李小華 10/21 13:00`。 */
  @Field(() => String)
  label!: string;

  @Field(() => GraphQLISODateTime)
  openedAt!: Date;

  /** 還開著(沒送出交班結帳)。 */
  @Field(() => Boolean)
  open!: boolean;

  /** 操作者自己開著的班(退款班次的預設 = 送出人目前的班)。 */
  @Field(() => Boolean)
  mine!: boolean;
}

@ObjectType("LotteryStoreShiftOptionsPayload")
export class LotteryStoreShiftOptionsPayload {
  @Field(() => [LotteryStoreShiftOptionModel])
  items!: LotteryStoreShiftOptionModel[];
}

/** 撤銷售出分頁的一列(ST-31a)。 */
@ObjectType("LotteryStoreSaleReversalRow")
export class LotteryStoreSaleReversalRowModel {
  /** 提交 id(點一列開表單引擎的詳情)。 */
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  /** 提交狀態(`reviewing` / `returned` / `withdrawn` / `completed` / `rejected`)。 */
  @Field(() => String)
  status!: string;

  /** 張數:每本一段 `5164 #031–032`。 */
  @Field(() => [String])
  ticketGroups!: string[];

  @Field(() => Int)
  ticketCount!: number;

  @Field(() => String)
  reasonLabel!: string;

  @Field(() => Boolean)
  refund!: boolean;

  /** 退款金額(退款 = 否時 0)。 */
  @Field(() => Int)
  refundAmount!: number;

  @Field(() => String, { nullable: true })
  refundShiftLabel!: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  submittedAt!: Date | null;
}

@ObjectType("LotteryStoreSaleReversalsPayload")
export class LotteryStoreSaleReversalsPayload {
  @Field(() => [LotteryStoreSaleReversalRowModel])
  items!: LotteryStoreSaleReversalRowModel[];
}

/** 現金更正分頁的一列(ST-32a)。 */
@ObjectType("LotteryStoreCashCorrectionRow")
export class LotteryStoreCashCorrectionRowModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  @Field(() => String)
  status!: string;

  /** `increase` / `decrease`。 */
  @Field(() => String)
  direction!: string;

  @Field(() => Int)
  amount!: number;

  /** `drawer` / `vault`。 */
  @Field(() => String)
  place!: string;

  /** 位置是某一班時那一班的名稱;小金庫 = null。 */
  @Field(() => String, { nullable: true })
  placeShiftLabel!: string | null;

  @Field(() => String, { nullable: true })
  attributedShiftLabel!: string | null;

  @Field(() => String)
  reasonLabel!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  submittedAt!: Date | null;
}

@ObjectType("LotteryStoreCashCorrectionsPayload")
export class LotteryStoreCashCorrectionsPayload {
  @Field(() => [LotteryStoreCashCorrectionRowModel])
  items!: LotteryStoreCashCorrectionRowModel[];
}
