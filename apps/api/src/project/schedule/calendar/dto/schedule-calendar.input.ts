import { Field, ID, InputType } from "@nestjs/graphql";

/** 某家店(缺席 = 當前組織)某個月(`YYYY-MM`)的行事曆。 */
@InputType()
export class ScheduleCalendarInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  month!: string;
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

  @Field(() => String)
  date!: string;

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
