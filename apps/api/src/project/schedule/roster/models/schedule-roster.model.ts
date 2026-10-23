import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { ScheduleTemplateTaskModel } from "../../templates/models/schedule-template.model";

/** 某家店某個月的發布狀態(這個月還沒有任何寫入時 = 未發布)。 */
@ObjectType("SchedulePeriod")
export class SchedulePeriodModel {
  /** `unpublished` 未發布 / `published` 已發布 */
  @Field(() => String)
  status!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  publishedAt!: Date | null;

  @Field(() => String, { nullable: true })
  publishedByName!: string | null;
}

/** 時段不可排的一段(時點;畫面以租戶時區顯示時刻)。 */
@ObjectType("ScheduleRosterSlot")
export class ScheduleRosterSlotModel {
  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;
}

/** 時段不可排的一天(畫休天數的 hover 明細)。 */
@ObjectType("ScheduleRosterTimeRangeDay")
export class ScheduleRosterTimeRangeDayModel {
  /** 那天(租戶時區 00:00 的時點) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => [ScheduleRosterSlotModel])
  slots!: ScheduleRosterSlotModel[];
}

/** 統計欄(這個月、這家店)。 */
@ObjectType("ScheduleRosterStats")
export class ScheduleRosterStatsModel {
  /** 班數 */
  @Field(() => Int)
  shiftCount!: number;

  /** 負責班數(以排班為單位:這筆排班任一任務是負責就算 1 班) */
  @Field(() => Int)
  leadShiftCount!: number;

  /** 總工時(分鐘;= 下班 − 上班 − 休息) */
  @Field(() => Int)
  workMinutes!: number;

  /** 畫休天數(那天有任何畫休就算 1 天,同畫休規則的算法) */
  @Field(() => Int)
  dayOffDays!: number;

  /** 其中整天畫休的天數 */
  @Field(() => Int)
  fullDayOffDays!: number;

  /** 有時段不可排的日子(只有時段、沒有整天畫休的那幾天) */
  @Field(() => [ScheduleRosterTimeRangeDayModel])
  timeRangeDays!: ScheduleRosterTimeRangeDayModel[];

  /** 最長連續上班天數(含在其他分店的班) */
  @Field(() => Int)
  longestStreak!: number;
}

/** 排班表的一個人(候選人;以及這個月在這家店有排班、但已不是候選人的人)。 */
@ObjectType("ScheduleRosterPerson")
export class ScheduleRosterPersonModel {
  @Field(() => ID)
  userId!: string;

  @Field(() => String)
  name!: string;

  /** `full-time` / `part-time`;不是候選人時為 null */
  @Field(() => String, { nullable: true })
  employmentType!: string | null;

  /** 這家店可擔任負責人 */
  @Field(() => Boolean)
  canLead!: boolean;

  /** 這家店是他的主要分店 */
  @Field(() => Boolean)
  isPrimary!: boolean;

  /** 目前可以排這家店(否則只是這個月還有排班) */
  @Field(() => Boolean)
  isCandidate!: boolean;

  @Field(() => ScheduleRosterStatsModel)
  stats!: ScheduleRosterStatsModel;
}

/** 人力需求的一筆執行任務 + 填的人(沒人填為 null)。 */
@ObjectType("ScheduleDemandTask")
export class ScheduleDemandTaskModel {
  @Field(() => String)
  taskId!: string;

  @Field(() => String)
  role!: string;

  @Field(() => String)
  taskKey!: string;

  @Field(() => ID, { nullable: true })
  entryId!: string | null;

  @Field(() => ID, { nullable: true })
  userId!: string | null;

  @Field(() => String, { nullable: true })
  userName!: string | null;
}

/** 人力需求。 */
@ObjectType("ScheduleDemand")
export class ScheduleDemandModel {
  @Field(() => ID)
  id!: string;

  /** 那天(開始時點在租戶時區那天的 00:00;跨午夜的算開始那天) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => String)
  positionKey!: string;

  /** 崗位旁的註記(刮刮樂登記的收銀點名稱;沒有登記為 null) */
  @Field(() => String, { nullable: true })
  positionNote!: string | null;

  @Field(() => [ScheduleDemandTaskModel])
  tasks!: ScheduleDemandTaskModel[];

  /** 來源範本;未套用範本(「臨」)或範本已刪除為 null */
  @Field(() => ID, { nullable: true })
  templateId!: string | null;

  /** `template` / `week-template` / `manual` / `auto` */
  @Field(() => String)
  source!: string;

  /** 建立時間(時間軸排序:開始時間 → 崗位 → 範本之後的平手規則) */
  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

/** 排班填進的一筆執行任務。 */
@ObjectType("ScheduleEntryAssignment")
export class ScheduleEntryAssignmentModel {
  @Field(() => ID)
  demandId!: string;

  @Field(() => String)
  taskId!: string;

  @Field(() => String)
  role!: string;

  @Field(() => String)
  taskKey!: string;

  /** `manual` / `auto` */
  @Field(() => String)
  source!: string;

  /** 自動填進的理由(自動排班寫;手動為 null),時間軸滑過提示用 */
  @Field(() => String, { nullable: true })
  reason!: string | null;
}

/** 排班。 */
@ObjectType("ScheduleEntry")
export class ScheduleEntryModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  userId!: string;

  /** 那天(上班時點在租戶時區那天的 00:00;跨午夜的算開始那天) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => Int)
  breakMinutes!: number;

  /** 能不能刪(沒被收銀班次綁定) */
  @Field(() => Boolean)
  deletable!: boolean;

  @Field(() => [ScheduleEntryAssignmentModel])
  assignments!: ScheduleEntryAssignmentModel[];
}

/** 這家店的人在其他分店的班(灰色區塊;看不到那家店時 `orgName` 為 null)。 */
@ObjectType("ScheduleOtherStoreEntry")
export class ScheduleOtherStoreEntryModel {
  @Field(() => ID)
  userId!: string;

  /** 那天(租戶時區 00:00 的時點) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => String, { nullable: true })
  orgName!: string | null;
}

/** 某人某天不能排(整天畫休 / 時段不可排)。 */
@ObjectType("ScheduleRosterUnavailability")
export class ScheduleRosterUnavailabilityModel {
  @Field(() => ID)
  userId!: string;

  /** 那天(租戶時區 00:00 的時點) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => Boolean)
  fullDay!: boolean;

  @Field(() => [ScheduleRosterSlotModel])
  slots!: ScheduleRosterSlotModel[];
}

/** 這家店某天的行事曆(生效的那一筆)。 */
@ObjectType("ScheduleRosterCalendarDay")
export class ScheduleRosterCalendarDayModel {
  /** 那天(租戶時區 00:00 的時點) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  /** `closed` 店休 / `special` 特殊日 */
  @Field(() => String)
  type!: string;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => String, { nullable: true })
  paletteKey!: string | null;
}

/** 這家店看得到的人力需求範本(人力需求區的列、新增時帶入)。 */
@ObjectType("ScheduleRosterTemplate")
export class ScheduleRosterTemplateModel {
  @Field(() => ID)
  id!: string;

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

  @Field(() => String, { nullable: true })
  paletteKey!: string | null;

  @Field(() => [ScheduleTemplateTaskModel])
  tasks!: ScheduleTemplateTaskModel[];
}

/** 規則「預設休息」的一級。 */
@ObjectType("ScheduleRosterBreakTier")
export class ScheduleRosterBreakTierModel {
  @Field(() => Int)
  minMinutes!: number;

  @Field(() => Int)
  breakMinutes!: number;
}

/** 這家店的規則生效值(排班表畫面要用的那幾條)。 */
@ObjectType("ScheduleRosterSettings")
export class ScheduleRosterSettingsModel {
  @Field(() => [ScheduleRosterBreakTierModel])
  breakTiers!: ScheduleRosterBreakTierModel[];

  @Field(() => String)
  defaultLeaderTaskKey!: string;

  @Field(() => String)
  defaultHelperTaskKey!: string;

  /** 每月最多 / 最少畫休(畫休天數超過上限或不足下限時變色) */
  @Field(() => Int, { nullable: true })
  maxMonthlyDayOffs!: number | null;

  @Field(() => Int, { nullable: true })
  minMonthlyDayOffs!: number | null;

  /** 對應排班容許時間(分;排班對話框預設勾選排班時間前後這段時間內的打卡) */
  @Field(() => Int)
  entryMatchToleranceMinutes!: number;
}

/** 這家店未對應排班的一張打卡(規格 14.5「未對應排班的打卡」)。 */
@ObjectType("ScheduleRosterPunch")
export class ScheduleRosterPunchModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  userId!: string;

  /** 打卡那天(打卡時點在租戶時區那天的 00:00) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  /** `in` 上班 / `out` 下班 */
  @Field(() => String)
  type!: string;

  @Field(() => GraphQLISODateTime)
  at!: Date;
}

@ObjectType("ScheduleRosterPayload")
export class ScheduleRosterPayload {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** `YYYY-MM` */
  @Field(() => String)
  month!: string;

  @Field(() => SchedulePeriodModel)
  period!: SchedulePeriodModel;

  /** 能不能改排班表(`schedule.manage.edit`) */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 能不能「同時存成人力需求範本」(`schedule.settings.edit-templates`) */
  @Field(() => Boolean)
  canSaveTemplate!: boolean;

  /** 排班對話框能不能勾「上下班時間改用打卡時間」(`schedule.manage.use-punch-time`) */
  @Field(() => Boolean)
  canUsePunchTime!: boolean;

  @Field(() => ScheduleRosterSettingsModel)
  settings!: ScheduleRosterSettingsModel;

  @Field(() => [ScheduleRosterPersonModel])
  people!: ScheduleRosterPersonModel[];

  @Field(() => [ScheduleDemandModel])
  demands!: ScheduleDemandModel[];

  @Field(() => [ScheduleEntryModel])
  entries!: ScheduleEntryModel[];

  @Field(() => [ScheduleOtherStoreEntryModel])
  otherStoreEntries!: ScheduleOtherStoreEntryModel[];

  @Field(() => [ScheduleRosterUnavailabilityModel])
  unavailability!: ScheduleRosterUnavailabilityModel[];

  @Field(() => [ScheduleRosterCalendarDayModel])
  calendarDays!: ScheduleRosterCalendarDayModel[];

  @Field(() => [ScheduleRosterTemplateModel])
  templates!: ScheduleRosterTemplateModel[];

  /** 讀取範圍內在這家店打的、未對應排班的卡(依時間;班表的時鐘圖示、排班對話框的區塊) */
  @Field(() => [ScheduleRosterPunchModel])
  unmatchedPunches!: ScheduleRosterPunchModel[];
}

@ObjectType("SaveScheduleDemandPayload")
export class SaveScheduleDemandPayload {
  @Field(() => ScheduleDemandModel)
  item!: ScheduleDemandModel;

  /** 解除後變成零筆、一起刪除的排班 */
  @Field(() => [ID])
  deletedEntryIds!: string[];
}

@ObjectType("DeleteScheduleDemandPayload")
export class DeleteScheduleDemandPayload {
  @Field(() => ID)
  id!: string;

  @Field(() => [ID])
  deletedEntryIds!: string[];
}

@ObjectType("SaveScheduleEntryPayload")
export class SaveScheduleEntryPayload {
  @Field(() => ScheduleEntryModel)
  item!: ScheduleEntryModel;
}

@ObjectType("DeleteScheduleEntryPayload")
export class DeleteScheduleEntryPayload {
  @Field(() => ID)
  id!: string;
}

@ObjectType("RemoveScheduleDayEntriesPayload")
export class RemoveScheduleDayEntriesPayload {
  @Field(() => [ID])
  deletedIds!: string[];

  /** 已被開班綁定、略過的排班 */
  @Field(() => [ID])
  skippedIds!: string[];
}
