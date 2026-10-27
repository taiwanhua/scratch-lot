import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

/** 班次結帳歷史紀錄分頁(ST-27):期間(送出時間)、收銀點、類型、狀態、頁碼。 */
@InputType()
export class LotteryCheckoutsInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  from?: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  to?: Date | null;

  @Field(() => ID, { nullable: true })
  cashPointId?: string | null;

  @Field(() => String, { nullable: true })
  type?: string | null;

  /** 申請的狀態(`reviewing` 待審核 / `returned` 已退回 / `completed` 已完成);空 = 全部 */
  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => Int, { nullable: true })
  offset?: number | null;

  @Field(() => Int, { nullable: true })
  limit?: number | null;
}
