import { Field, GraphQLISODateTime, ID, InputType } from "@nestjs/graphql";

/**
 * 一段時段不可排:那天的開始 / 結束時點(admin 以租戶時區把日期 + `HH:mm` 合成時點);
 * 都要落在 `date` 那天、結束晚於開始(不跨午夜),精度到分鐘。
 */
@InputType()
export class ScheduleDayOffSlotInput {
  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;
}

/**
 * 我的畫休(SC-02):`from` / `to` = 那個月的時點區間 `[月初 00:00, 下月初 00:00)`(租戶時區);
 * 兩個都缺席 = 目前在登記的月份(下個月)。
 */
@InputType()
export class MyScheduleDayOffsInput {
  @Field(() => GraphQLISODateTime, { nullable: true })
  from?: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  to?: Date | null;
}

/**
 * 本人登記畫休(SC-41a / b):整天畫休一筆;時段不可排可以一次送多段(`slots` 至少一段)。
 * 只能在開放期間內登記目標月的日期;違反限制不存。
 */
@InputType()
export class AddMyScheduleDayOffsInput {
  /** 那天(租戶時區 00:00 的時點;api 以租戶時區正規化成那天 00:00) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  /** `full-day` / `time-range` */
  @Field(() => String)
  kind!: string;

  @Field(() => [ScheduleDayOffSlotInput], { nullable: true })
  slots?: ScheduleDayOffSlotInput[] | null;

  @Field(() => String, { nullable: true })
  note?: string | null;
}

@InputType()
export class DeleteMyScheduleDayOffInput {
  @Field(() => ID)
  id!: string;
}

/**
 * 畫休總覽(SC-06):某家店(缺席 = 當前組織)某個月:`from` / `to` 同我的畫休
 * (那個月的時點區間;兩個都缺席 = 目前在登記的月份)。
 */
@InputType()
export class ScheduleDayOffOverviewInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  from?: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  to?: Date | null;
}

/**
 * 代改畫休(SC-24):替這家店的排班人員登記;截止後 `reason` 必填(欄位管理「代改畫休原因」),
 * 選「其他」`reasonNote` 必填。
 */
@InputType()
export class AddScheduleDayOffsOnBehalfInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => ID)
  userId!: string;

  /** 那天(同本人登記) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => String)
  kind!: string;

  @Field(() => [ScheduleDayOffSlotInput], { nullable: true })
  slots?: ScheduleDayOffSlotInput[] | null;

  @Field(() => String, { nullable: true })
  reason?: string | null;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/** 代改刪除一段畫休;原因規則同代改登記。 */
@InputType()
export class DeleteScheduleDayOffOnBehalfInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  reason?: string | null;

  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}
