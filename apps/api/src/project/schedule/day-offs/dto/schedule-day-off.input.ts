import { Field, ID, InputType } from "@nestjs/graphql";

/** 一段時段不可排(`HH:mm`,結束晚於開始;不跨午夜)。 */
@InputType()
export class ScheduleDayOffSlotInput {
  @Field(() => String)
  startTime!: string;

  @Field(() => String)
  endTime!: string;
}

/** 我的畫休(SC-02):缺席 = 目前在登記的月份(下個月)。 */
@InputType()
export class MyScheduleDayOffsInput {
  /** `YYYY-MM` */
  @Field(() => String, { nullable: true })
  month?: string | null;
}

/**
 * 本人登記畫休(SC-41a / b):整天畫休一筆;時段不可排可以一次送多段(`slots` 至少一段)。
 * 只能在開放期間內登記目標月的日期;違反限制不存。
 */
@InputType()
export class AddMyScheduleDayOffsInput {
  /** `YYYY-MM-DD` */
  @Field(() => String)
  date!: string;

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

/** 畫休總覽(SC-06):某家店(缺席 = 當前組織)某個月(缺席 = 目前在登記的月份)。 */
@InputType()
export class ScheduleDayOffOverviewInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String, { nullable: true })
  month?: string | null;
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

  @Field(() => String)
  date!: string;

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
