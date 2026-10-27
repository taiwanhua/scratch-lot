import { Field, ID, InputType, Int } from "@nestjs/graphql";

/** [存銀行](規格 6.11):小金庫 → 銀行,不用審核、做完就生效。 */
@InputType()
export class DepositLotteryVaultToBankInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => Int)
  amount!: number;

  @Field(() => ID)
  accountId!: string;

  @Field(() => String, { nullable: true })
  note?: string | null;
}
