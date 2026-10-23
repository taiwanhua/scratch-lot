import { Field, GraphQLISODateTime, ID, InputType } from "@nestjs/graphql";

/**
 * 某家店(缺席 = 當前組織)一段期間的行事曆:`from` / `to` 是半開的時點區間 `[起, 迄)`
 * (月 = 租戶時區的月初 00:00 到下月初 00:00);最長一個月(31 天再多一小時給夏令時間)。
 */
@InputType()
export class ScheduleCalendarInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => GraphQLISODateTime)
  from!: Date;

  @Field(() => GraphQLISODateTime)
  to!: Date;
}

/**
 * 新增 / 修改一天的店休或特殊日(整份送;修改時帶 `id`)。寫在 `orgId` 那一層(缺席 = 當前組織)。
 * 特殊日:`category`、`name` 必填,`paletteKey` 選填;店休:`category`、`paletteKey` 一律存 null。
 */
@InputType()
export class SaveScheduleCalendarDayInput {
  @Field(() => ID, { nullable: true })
  id?: string | null;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** 那天(租戶時區 00:00 的時點;api 以租戶時區正規化成那天 00:00) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => String)
  type!: string;

  @Field(() => String, { nullable: true })
  category?: string | null;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => String, { nullable: true })
  paletteKey?: string | null;
}

@InputType()
export class DeleteScheduleCalendarDayInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;
}
