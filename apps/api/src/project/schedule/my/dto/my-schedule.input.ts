import { Field, ID, InputType } from "@nestjs/graphql";

/** 我的班表 → 班表分頁(SC-01):缺席 = 今天所在的月份(租戶時區)。 */
@InputType()
export class MyScheduleInput {
  /** `YYYY-MM` */
  @Field(() => String, { nullable: true })
  month?: string | null;
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
