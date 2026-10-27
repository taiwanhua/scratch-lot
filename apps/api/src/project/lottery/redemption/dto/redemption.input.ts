import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

/**
 * 兌獎(規格 6.5;ST-11a):`code` = 刷到 / 輸入的編號(建議背面編號;正面編號 / 條碼要對得到本店唯一的遊戲)。
 * 金額正整數、≤ 5,000、≤ 抽屜目前的應有。
 */
@InputType()
export class RedeemLotteryTicketInput {
  @Field(() => ID)
  shiftId!: string;

  @Field(() => String)
  code!: string;

  @Field(() => Int)
  prizeAmount!: number;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 兌獎視窗刷到編號後的預覽(遊戲、本號、張號、是不是本店的、是否已兌過)。 */
@InputType()
export class LotteryRedemptionPreviewInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  code!: string;
}

/**
 * 撤銷兌獎(規格 6.5 兩層):自己登記、班開著 → 不用原因;其他(`store.undo-redeem`)→ 原因必填
 * (欄位管理「撤銷兌獎原因」,選「其他」說明必填)+ 說明。
 */
@InputType()
export class RevokeLotteryRedemptionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  reasonKey?: string | null;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/** [撤銷並重新登記](`store.undo-redeem`):撤銷 + 在同一班登記正確的那筆(`replacesId` 指向原紀錄)。 */
@InputType()
export class ReplaceLotteryRedemptionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  reasonKey?: string | null;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;

  @Field(() => String)
  code!: string;

  @Field(() => Int)
  prizeAmount!: number;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

/** 兌獎紀錄分頁的篩選(規格 6.5;ST-40)。期間以登記時間;不給 = 不限。 */
@InputType()
export class LotteryRedemptionsInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  from?: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  to?: Date | null;

  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;

  /** `in_store` / `sent` / `revoked` */
  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => ID, { nullable: true })
  redeemedBy?: string | null;

  /** 單號(`RD-0218` 或 `218` 都可;`redemptionSerialQueryOf` 正規化後完全比對);空白 = 不篩;有值時不看 `from` / `to`。 */
  @Field(() => String, { nullable: true })
  serialNo?: string | null;

  @Field(() => Int, { nullable: true })
  offset?: number | null;

  @Field(() => Int, { nullable: true })
  limit?: number | null;
}
