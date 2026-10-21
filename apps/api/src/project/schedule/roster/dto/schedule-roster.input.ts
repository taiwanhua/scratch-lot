import { Field, GraphQLISODateTime, ID, InputType, Int } from "@nestjs/graphql";

/**
 * 發布後的異動原因(規格 14.5:已發布的月份,兩種對話框都多一個「異動原因」,必填)。
 * 未發布的月份不用給;給了也不記。
 */
@InputType()
export class ScheduleChangeReasonInput {
  /** 欄位管理「排班異動原因」的選項 value */
  @Field(() => String)
  reasonKey!: string;

  /** 選「其他」必填 */
  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

/** 某家店(缺席 = 當前組織)某個月(`YYYY-MM`)的排班表。 */
@InputType()
export class ScheduleRosterInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  month!: string;

  /**
   * 週檢視跨月時多讀的日期範圍(`YYYY-MM-DD`,含頭尾;要一起給):人力需求、排班、別家店的班、畫休、
   * 行事曆改讀「這個月 ∪ from–to」;統計與發布狀態仍只算這個月。只能落在這個月前後 6 天內。
   */
  @Field(() => String, { nullable: true })
  from?: string | null;

  @Field(() => String, { nullable: true })
  to?: string | null;
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

  /** 已發布的月份必填(見 `ScheduleChangeReasonInput`) */
  @Field(() => ScheduleChangeReasonInput, { nullable: true })
  changeReason?: ScheduleChangeReasonInput | null;
}

@InputType()
export class DeleteScheduleDemandInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** 已發布的月份必填(見 `ScheduleChangeReasonInput`) */
  @Field(() => ScheduleChangeReasonInput, { nullable: true })
  changeReason?: ScheduleChangeReasonInput | null;
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

  /**
   * 一起對應到這筆排班的未對應排班的打卡(規格 14.5「排班對話框的區塊」:這個人那天在這家店的卡;
   * 勾選的才給)。沒給 = 不動任何打卡
   */
  @Field(() => [ID], { nullable: true })
  punchIds?: string[] | null;

  /**
   * 上下班時間改用打卡時間(要 `schedule.manage.use-punch-time`):上班 = 勾選的上班卡中最早的、
   * 下班 = 勾選的下班卡中最晚的(沒勾那一種就照送來的時間)
   */
  @Field(() => Boolean, { nullable: true })
  usePunchTime?: boolean | null;

  /** 已發布的月份必填(見 `ScheduleChangeReasonInput`) */
  @Field(() => ScheduleChangeReasonInput, { nullable: true })
  changeReason?: ScheduleChangeReasonInput | null;
}

@InputType()
export class DeleteScheduleEntryInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** 已發布的月份必填(見 `ScheduleChangeReasonInput`) */
  @Field(() => ScheduleChangeReasonInput, { nullable: true })
  changeReason?: ScheduleChangeReasonInput | null;
}

/** 移除這天所有排班(`YYYY-MM-DD`)。 */
@InputType()
export class RemoveScheduleDayEntriesInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  date!: string;

  /** 已發布的月份必填(見 `ScheduleChangeReasonInput`) */
  @Field(() => ScheduleChangeReasonInput, { nullable: true })
  changeReason?: ScheduleChangeReasonInput | null;
}
