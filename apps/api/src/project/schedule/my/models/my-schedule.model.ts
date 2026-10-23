import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { ScheduleRosterCalendarDayModel } from "../../roster/models/schedule-roster.model";

/** 排班填進的一筆執行任務(職責、任務內容、所在人力需求的崗位)。 */
@ObjectType("MyScheduleTask")
export class MyScheduleTaskModel {
  /** `leader` 負責人 / `helper` 協同 */
  @Field(() => String)
  role!: string;

  /** 任務內容(欄位管理「執行任務」的選項 value) */
  @Field(() => String)
  taskKey!: string;

  /** 崗位(欄位管理「崗位」的選項 value) */
  @Field(() => String)
  positionKey!: string;
}

/** 我的一筆排班(只有已發布的月份),連同打卡紀錄與缺卡。 */
@ObjectType("MyScheduleEntry")
export class MyScheduleEntryModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 那天(上班時點在租戶時區那天的 00:00) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => Int)
  breakMinutes!: number;

  /** 範本簡稱(填進的人力需求是套用範本建的;負責那一筆優先);null = 未套用範本(畫面顯示「臨」) */
  @Field(() => String, { nullable: true })
  shortName!: string | null;

  /** 填進負責人的執行任務 */
  @Field(() => Boolean)
  isLead!: boolean;

  /** 主要崗位(負責那一筆優先,再取人力需求開始較早的);沒有填進任何執行任務 = null */
  @Field(() => String, { nullable: true })
  positionKey!: string | null;

  @Field(() => [MyScheduleTaskModel])
  tasks!: MyScheduleTaskModel[];

  /** 生效的上班卡(最早那張) */
  @Field(() => GraphQLISODateTime, { nullable: true })
  clockIn!: Date | null;

  /** 生效的下班卡(最晚那張) */
  @Field(() => GraphQLISODateTime, { nullable: true })
  clockOut!: Date | null;

  /** 已結束的班缺的卡(`in` / `out`);還沒結束 = 空 */
  @Field(() => [String])
  missing!: string[];
}

/** 打卡區的一張排班卡片:今天的班,或昨天還沒打下班卡的班(只能打下班卡)。 */
@ObjectType("MySchedulePunchCard")
export class MySchedulePunchCardModel {
  /** `today` / `yesterday` */
  @Field(() => String)
  day!: string;

  @Field(() => MyScheduleEntryModel)
  entry!: MyScheduleEntryModel;
}

/** 一張打卡。 */
@ObjectType("MySchedulePunch")
export class MySchedulePunchModel {
  @Field(() => ID)
  id!: string;

  /** `in` / `out` */
  @Field(() => String)
  type!: string;

  @Field(() => GraphQLISODateTime)
  at!: Date;

  /** 對應排班;null = 未對應排班 */
  @Field(() => ID, { nullable: true })
  entryId!: string | null;

  @Field(() => ID)
  orgId!: string;

  @Field(() => Boolean)
  duplicate!: boolean;
}

/** 最近異動的一筆(發布後的排班異動,只列還沒到的班)。 */
@ObjectType("MyScheduleChange")
export class MyScheduleChangeModel {
  @Field(() => ID)
  id!: string;

  /** 異動那天(租戶時區 00:00 的時點) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  /** `entry.create` / `entry.edit` / `entry.delete` / `demand.*` */
  @Field(() => String)
  action!: string;

  @Field(() => String)
  orgName!: string;

  /** 原本的時間(新增時 null) */
  @Field(() => GraphQLISODateTime, { nullable: true })
  beforeStartAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  beforeEndAt!: Date | null;

  /** 現在的時間(刪除時 null) */
  @Field(() => GraphQLISODateTime, { nullable: true })
  afterStartAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  afterEndAt!: Date | null;

  /** 異動原因的顯示名稱(選項已停用時退回選項 value) */
  @Field(() => String)
  reason!: string;

  @Field(() => String, { nullable: true })
  reasonNote!: string | null;

  /** 異動時間(判斷「新」:晚於上次打開這一頁) */
  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

/** 「沒有排班」區塊打卡的分店(= 當前組織)。 */
@ObjectType("MyScheduleOrg")
export class MyScheduleOrgModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/**
 * 我的班表 → 班表分頁(SC-01;規格 14.6):以人為單位、跨分店合併、只有已發布的班。
 * 打卡區、打卡不完整提醒、最近異動與這個月的月曆一次回。
 */
@ObjectType("MySchedulePayload")
export class MySchedulePayload {
  /** `YYYY-MM` */
  @Field(() => String)
  month!: string;

  /** 今天(租戶時區 00:00 的時點) */
  @Field(() => GraphQLISODateTime)
  today!: Date;

  /** 有 `schedule.my.punch`(沒有就不顯示打卡按鈕) */
  @Field(() => Boolean)
  canPunch!: boolean;

  /** 「沒有排班」區塊打卡的分店(當前組織) */
  @Field(() => MyScheduleOrgModel)
  currentOrg!: MyScheduleOrgModel;

  /** 這個月的班(依上班時點) */
  @Field(() => [MyScheduleEntryModel])
  entries!: MyScheduleEntryModel[];

  /** 打卡區:今天的班在前,再來是昨天未打下班卡的班 */
  @Field(() => [MySchedulePunchCardModel])
  punchCards!: MySchedulePunchCardModel[];

  /** 今天有沒有排班(「沒有排班」區塊:有班時收合成一行連結) */
  @Field(() => Boolean)
  hasEntryToday!: boolean;

  /** 今天打了、還沒打下班卡的未對應排班上班卡(「沒有排班」區塊展開並醒目顯示 [打下班卡]) */
  @Field(() => MySchedulePunchModel, { nullable: true })
  openUnmatchedClockIn!: MySchedulePunchModel | null;

  /** 最近 7 天打卡不完整的班(已結束、上下班都檢查;依上班時點) */
  @Field(() => [MyScheduleEntryModel])
  incomplete!: MyScheduleEntryModel[];

  /** 最近異動:還沒到的班的異動(異動時間新到舊) */
  @Field(() => [MyScheduleChangeModel])
  changes!: MyScheduleChangeModel[];

  /** 當前組織這個月的店休 / 特殊日(月曆背景色) */
  @Field(() => [ScheduleRosterCalendarDayModel])
  calendarDays!: ScheduleRosterCalendarDayModel[];

  /** 這個月我有整天畫休的日子(各是那天租戶時區 00:00 的時點) */
  @Field(() => [GraphQLISODateTime])
  dayOffDates!: Date[];
}
