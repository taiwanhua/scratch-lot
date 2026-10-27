import { Field, InputType } from "@nestjs/graphql";

/** [關帳](規格 10.4;Figma AC-07):輸入月份確認要和要關的月份相同。 */
@InputType()
export class CloseLotteryPeriodInput {
  /** `YYYY-MM` */
  @Field(() => String)
  month!: string;

  /** 輸入月份確認(要等於 `month`) */
  @Field(() => String)
  confirmMonth!: string;

  @Field(() => String, { nullable: true })
  note?: string | null;
}
