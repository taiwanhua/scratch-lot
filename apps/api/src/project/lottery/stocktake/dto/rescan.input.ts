import { Field, ID, InputType } from "@nestjs/graphql";

/**
 * 全店重刷(張數店規格 8.4、14.2 `startLotteryRescan` / `finishLotteryRescanPlace` / `cancelLotteryRescan`)的輸入。
 * 位置:`cashPointId` = 收銀點;不給(null)= 庫存。
 */

/** [開始全店重刷 遊戲 X]。 */
@InputType()
export class StartLotteryRescanInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  gameId!: string;
}

/** 重刷頁(CS-10b)。 */
@InputType()
export class LotteryRescanInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  rescanId!: string;
}

/** 在一個位置刷到一張(條碼、相機或手輸張號;每刷一張就存)。 */
@InputType()
export class ScanLotteryRescanTicketInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  rescanId!: string;

  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;

  @Field(() => String)
  code!: string;
}

/** [這裡刷完了] / 位置。 */
@InputType()
export class FinishLotteryRescanPlaceInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  rescanId!: string;

  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;
}
