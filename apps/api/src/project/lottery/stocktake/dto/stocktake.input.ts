import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

import { LotteryStoreTicketRefInput } from "../../store/dto/lottery-store-sales.input";

/** 盤點頁(ST-13):分店 + 範圍(單一收銀點;全店不給)。 */
@InputType()
export class LotteryStocktakeSheetInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;
}

/** 差異核對 / 送出前檢查:`draft` = 盤點內容(`serializeStocktakeDraft` 的 JSON)。 */
@InputType()
export class LotteryStocktakeReviewInput {
  @Field(() => String)
  draft!: string;
}

/** 補登售出(立即生效;`store.sell` + `store.stocktake`):檯面上未售的張與盤點時讀到的版本。 */
@InputType()
export class BackfillLotteryStocktakeSalesInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => [LotteryStoreTicketRefInput])
  tickets!: LotteryStoreTicketRefInput[];
}

/** 盤點紀錄分頁(ST-29):期間(送出時間)、類型、狀態、頁碼。 */
@InputType()
export class LotteryStocktakesInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  from?: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  to?: Date | null;

  @Field(() => String, { nullable: true })
  type?: string | null;

  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => Int, { nullable: true })
  offset?: number | null;

  @Field(() => Int, { nullable: true })
  limit?: number | null;
}
