import {
  Field,
  Float,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { SchedulePeriodModel } from "../../roster/models/schedule-roster.model";

/** 人力不足一段時間的明細。 */
@ObjectType("ScheduleCheckUnderstaffed")
export class ScheduleCheckUnderstaffedModel {
  @Field(() => ID)
  demandId!: string;

  /** `leader` 負責 / `helper` 協同 */
  @Field(() => String)
  role!: string;

  @Field(() => Int)
  missing!: number;

  /** 那段時間可以排的人 */
  @Field(() => Int)
  available!: number;

  /** 沒有可排的原因(人數):整天畫休、時段不可排、已排其他班、不能擔任負責人 */
  @Field(() => Int)
  dayOff!: number;

  @Field(() => Int)
  timeRange!: number;

  @Field(() => Int)
  occupied!: number;

  @Field(() => Int)
  cannotLead!: number;
}

/**
 * 檢核面板的一項(規格 14.5「檢核面板」):規則名稱與違反的排班。
 * `key` = 規則 key(`SCHEDULE_RULE_DEFINITIONS`),或不屬於規則的檢核類別
 * (`dayOffEntryConflict` 畫休日有排班;之後的「未對應排班的打卡」也列在這裡)。
 */
@ObjectType("ScheduleCheckItem")
export class ScheduleCheckItemModel {
  @Field(() => String)
  key!: string;

  /** `limit` 限制 / `reminder` 提醒 */
  @Field(() => String)
  level!: string;

  /** api 端的中文說明(畫面依 `key` 與數字自己組文案) */
  @Field(() => String)
  message!: string;

  /** 人的規則:那個人;店的規則 null */
  @Field(() => ID, { nullable: true })
  userId!: string | null;

  @Field(() => String, { nullable: true })
  userName!: string | null;

  /** [查看] 要捲到的那一天(`YYYY-MM-DD`;人的規則捲到 `userId|date`) */
  @Field(() => String)
  date!: string;

  /** 違反的排班 */
  @Field(() => [ID])
  entryIds!: string[];

  @Field(() => Float, { nullable: true })
  actual!: number | null;

  @Field(() => Float, { nullable: true })
  limit!: number | null;

  /** 期間(連續上班、兩班之間的休息)的起訖日 */
  @Field(() => String, { nullable: true })
  from!: string | null;

  @Field(() => String, { nullable: true })
  to!: string | null;

  /** 違反的那段時間(兩班之間的休息、兼多個崗位的重疊、人力不足的時段、畫休日的那筆排班) */
  @Field(() => GraphQLISODateTime, { nullable: true })
  startAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  endAt!: Date | null;

  /** 畫休日有排班:排班在別家店;`orgName` = 那家店的名稱(看不到 = null) */
  @Field(() => Boolean)
  isOtherStore!: boolean;

  @Field(() => String, { nullable: true })
  orgName!: string | null;

  @Field(() => ScheduleCheckUnderstaffedModel, { nullable: true })
  understaffed!: ScheduleCheckUnderstaffedModel | null;
}

/** 一家店一個月的檢核結果(限制在前、各自依規則排序)。 */
@ObjectType("ScheduleCheckPayload")
export class ScheduleCheckPayload {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  month!: string;

  @Field(() => [ScheduleCheckItemModel])
  items!: ScheduleCheckItemModel[];

  @Field(() => Int)
  limitCount!: number;

  @Field(() => Int)
  reminderCount!: number;
}

/** 發布的結果:這個月的狀態。 */
@ObjectType("PublishSchedulePayload")
export class PublishSchedulePayload {
  @Field(() => SchedulePeriodModel)
  period!: SchedulePeriodModel;

  /** 通知了幾位被排到的人 */
  @Field(() => Int)
  notifiedCount!: number;
}
