import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

/** 某家店(缺席 = 當前組織)某個月(`YYYY-MM`)的排班表。 */
@InputType()
export class ScheduleRosterInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  month!: string;
}

/** 人力需求的一筆執行任務;`taskId` 缺席 = 新的一筆(api 產生)。 */
@InputType()
export class ScheduleDemandTaskInput {
  @Field(() => String, { nullable: true })
  taskId?: string | null;

  /** `leader` 負責人 / `helper` 協同 */
  @Field(() => String)
  role!: string;

  /** 任務內容(欄位管理「執行任務」的選項 value) */
  @Field(() => String)
  taskKey!: string;
}

/** 「同時存成人力需求範本」:範本名稱與簡稱(1–2 字)。 */
@InputType()
export class ScheduleDemandTemplateCopyInput {
  @Field(() => String)
  name!: string;

  @Field(() => String)
  shortName!: string;
}

/**
 * 新增 / 修改一筆人力需求(整份送;修改時帶 `id`)。日期 = 開始時點在租戶時區的那一天。
 * 修改時拿掉的執行任務若有人填 → 解除;解除後變成零筆的排班一起刪除(被綁定的擋下)。
 */
@InputType()
export class SaveScheduleDemandInput {
  @Field(() => ID, { nullable: true })
  id?: string | null;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => String)
  positionKey!: string;

  @Field(() => [ScheduleDemandTaskInput])
  tasks!: ScheduleDemandTaskInput[];

  /** 從班表人力需求區某一列範本新增時帶入的範本(只在新增時採用) */
  @Field(() => ID, { nullable: true })
  templateId?: string | null;

  /** 只在新增時:同時存成人力需求範本(要 `schedule.settings.edit-templates`) */
  @Field(() => ScheduleDemandTemplateCopyInput, { nullable: true })
  saveAsTemplate?: ScheduleDemandTemplateCopyInput | null;
}

@InputType()
export class DeleteScheduleDemandInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;
}

/** 排班填進的一筆執行任務。 */
@InputType()
export class ScheduleEntryAssignmentInput {
  @Field(() => ID)
  demandId!: string;

  @Field(() => String)
  taskId!: string;
}

/**
 * 新增 / 修改一筆排班(整份送;修改時帶 `id`,人員不能改)。
 * `assignments` 至少一筆;同一筆人力需求只能一筆。
 */
@InputType()
export class SaveScheduleEntryInput {
  @Field(() => ID, { nullable: true })
  id?: string | null;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** 新增時必填;修改時忽略 */
  @Field(() => ID, { nullable: true })
  userId?: string | null;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => Int)
  breakMinutes!: number;

  @Field(() => [ScheduleEntryAssignmentInput])
  assignments!: ScheduleEntryAssignmentInput[];
}

@InputType()
export class DeleteScheduleEntryInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;
}

/** 移除這天所有排班(`YYYY-MM-DD`)。 */
@InputType()
export class RemoveScheduleDayEntriesInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  date!: string;
}
