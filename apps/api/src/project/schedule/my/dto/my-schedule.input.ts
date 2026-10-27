import { Field, GraphQLISODateTime, ID, InputType } from "@nestjs/graphql";

/**
 * 我的班表 → 班表分頁(SC-01):`from` / `to` = 那個月的時點區間 `[月初 00:00, 下月初 00:00)`(租戶時區);
 * 兩個都缺席 = 今天所在的月份。
 */
@InputType()
export class MyScheduleInput {
  @Field(() => GraphQLISODateTime, { nullable: true })
  from?: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  to?: Date | null;
}

/**
 * 打卡(`schedule.my.punch`):在排班卡片上打 = 帶那一筆排班;「沒有排班」區塊打 = `entryId` 不給
 * (未對應排班,記在當前組織)。時間由伺服器決定。
 */
@InputType()
export class PunchMyScheduleInput {
  /** `in` 上班 / `out` 下班 */
  @Field(() => String)
  type!: string;

  @Field(() => ID, { nullable: true })
  entryId?: string | null;
}
