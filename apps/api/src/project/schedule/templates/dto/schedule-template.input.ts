import { Field, ID, InputType } from "@nestjs/graphql";

/** 一筆執行任務;`taskId` 缺席 = 新的一筆(由 api 產生)。 */
@InputType()
export class ScheduleTemplateTaskInput {
  @Field(() => ID, { nullable: true })
  taskId?: string | null;

  /** `leader` / `helper` */
  @Field(() => String)
  role!: string;

  @Field(() => String)
  taskKey!: string;
}

/**
 * 新增 / 修改人力需求範本(整份送;修改時帶 `id`)。新增的範本屬於當前組織。
 * `paletteKey`:`null` = 不設定顏色。
 */
@InputType()
export class SaveScheduleDemandTemplateInput {
  @Field(() => ID, { nullable: true })
  id?: string | null;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  shortName!: string;

  @Field(() => String)
  startTime!: string;

  @Field(() => String)
  endTime!: string;

  @Field(() => String)
  positionKey!: string;

  @Field(() => [ScheduleTemplateTaskInput])
  tasks!: ScheduleTemplateTaskInput[];

  @Field(() => String, { nullable: true })
  paletteKey?: string | null;
}

/** 新增 / 修改人力需求週範本(整份送;修改時帶 `id`)。`days` 固定 7 格(0 = 星期日)。 */
@InputType()
export class SaveScheduleDemandWeekTemplateInput {
  @Field(() => ID, { nullable: true })
  id?: string | null;

  @Field(() => String)
  name!: string;

  @Field(() => [[ID]])
  days!: string[][];

  @Field(() => Boolean, { nullable: true })
  enabled?: boolean;
}

@InputType()
export class DeleteScheduleTemplateInput {
  @Field(() => ID)
  id!: string;
}

/** 週範本列表:某家店(缺席或 null = 當前組織)看得到的週範本。 */
@InputType()
export class ScheduleDemandWeekTemplatesInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;
}
