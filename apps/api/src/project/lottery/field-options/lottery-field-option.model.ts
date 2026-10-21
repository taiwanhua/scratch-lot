import { Field, Int, ObjectType } from "@nestjs/graphql";

/** 欄位管理類別的一個選項(存 value、顯示 label)。 */
@ObjectType("LotteryFieldOption")
export class LotteryFieldOptionModel {
  @Field(() => String)
  value!: string;

  @Field(() => String)
  label!: string;
}

@ObjectType("LotteryFieldOptionsPayload")
export class LotteryFieldOptionsPayload {
  @Field(() => [LotteryFieldOptionModel])
  items!: LotteryFieldOptionModel[];

  @Field(() => Int)
  totalCount!: number;
}
