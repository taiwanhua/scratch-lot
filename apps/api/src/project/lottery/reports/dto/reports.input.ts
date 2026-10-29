import { Field, GraphQLISODateTime, ID, InputType } from "@nestjs/graphql";

/**
 * 報表查詢共用的範圍(輸出報表外框送來的 input;正本 `docs/modules/reports.md`「報表登記介面」):
 * 期間類型照收字串、交給 `assertReportRange` 驗;起訖是 admin 依租戶時區換好的時點(迄不含)。
 */
@InputType({ isAbstract: true })
export class LotteryReportRangeInput {
  /** `day` / `week` / `month` */
  @Field(() => String)
  periodKind!: string;

  @Field(() => GraphQLISODateTime)
  from!: Date;

  @Field(() => GraphQLISODateTime)
  to!: Date;

  @Field(() => [ID])
  orgIds!: string[];
}

/** 營運報表(規格 11.2):另有「對齊日結」(只有日)。 */
@InputType()
export class LotteryOperationsReportInput extends LotteryReportRangeInput {
  @Field(() => Boolean, { nullable: true })
  alignDailyClose?: boolean | null;
}

/** 班次結帳歷史報表(規格 11.3):另有收銀點(空 = 全部)、只看有差額。 */
@InputType()
export class LotteryShiftCheckoutsReportInput extends LotteryReportRangeInput {
  /** 收銀點 id;空字串 / 不給 = 全部 */
  @Field(() => String, { nullable: true })
  cashPointId?: string | null;

  @Field(() => Boolean, { nullable: true })
  onlyWithDifference?: boolean | null;
}
