import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { ScheduleOwnerOrgModel } from "../../templates/models/schedule-template.model";

/** 某家店某天的行事曆(生效的那一筆:最接近的那一層)。 */
@ObjectType("ScheduleCalendarDay")
export class ScheduleCalendarDayModel {
  @Field(() => ID)
  id!: string;

  /** 那天(租戶時區 00:00 的時點) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  /** `closed` 店休 / `special` 特殊日 */
  @Field(() => String)
  type!: string;

  /** 特殊日類別(欄位管理「特殊日類別」的選項 value);店休為 null */
  @Field(() => String, { nullable: true })
  category!: string | null;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** 特殊日的顏色(標籤色票代號);店休為 null */
  @Field(() => String, { nullable: true })
  paletteKey!: string | null;

  /** 設定這一天的組織(本店或沿用的上層) */
  @Field(() => ScheduleOwnerOrgModel)
  ownerOrg!: ScheduleOwnerOrgModel;

  /** 這位操作者能不能改 / 刪(這一層設的 + `edit-calendar`) */
  @Field(() => Boolean)
  canEdit!: boolean;
}

@ObjectType("ScheduleCalendarPayload")
export class ScheduleCalendarPayload {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 查詢的期間(照輸入回):`[from, to)` */
  @Field(() => GraphQLISODateTime)
  from!: Date;

  @Field(() => GraphQLISODateTime)
  to!: Date;

  /** 能不能 [新增](`schedule.manage.edit-calendar`) */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 這段期間有行事曆的日子(依日期) */
  @Field(() => [ScheduleCalendarDayModel])
  days!: ScheduleCalendarDayModel[];
}

/** 設成店休那天已經有人力需求 / 排班的一家店(先有資料、後設店休:照樣存,提醒去刪)。 */
@ObjectType("ScheduleCalendarClosedConflict")
export class ScheduleCalendarClosedConflictModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 那天的人力需求筆數 */
  @Field(() => Int)
  demandCount!: number;

  /** 那天的排班筆數 */
  @Field(() => Int)
  entryCount!: number;
}

@ObjectType("ScheduleCalendarDayPayload")
export class ScheduleCalendarDayPayload {
  @Field(() => ScheduleCalendarDayModel)
  item!: ScheduleCalendarDayModel;

  /**
   * 存成店休時,那天(含前一天跨午夜做進來的)已經有人力需求 / 排班的店(這一層與沿用這一天的下層各店;
   * 下層自己另設那天的不算);照樣存,畫面提醒去刪。特殊日一律空陣列。
   */
  @Field(() => [ScheduleCalendarClosedConflictModel])
  closedConflicts!: ScheduleCalendarClosedConflictModel[];
}

@ObjectType("DeleteScheduleCalendarDayPayload")
export class DeleteScheduleCalendarDayPayload {
  @Field(() => ID)
  id!: string;
}
