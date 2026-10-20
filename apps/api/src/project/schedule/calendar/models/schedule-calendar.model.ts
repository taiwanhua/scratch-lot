import { Field, ID, ObjectType } from "@nestjs/graphql";

import { ScheduleOwnerOrgModel } from "../../templates/models/schedule-template.model";

/** 某家店某天的行事曆(生效的那一筆:最接近的那一層)。 */
@ObjectType("ScheduleCalendarDay")
export class ScheduleCalendarDayModel {
  @Field(() => ID)
  id!: string;

  /** `YYYY-MM-DD` */
  @Field(() => String)
  date!: string;

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

  /** `YYYY-MM` */
  @Field(() => String)
  month!: string;

  /** 能不能 [新增](`schedule.manage.edit-calendar`) */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 這個月有行事曆的日子(依日期) */
  @Field(() => [ScheduleCalendarDayModel])
  days!: ScheduleCalendarDayModel[];
}

@ObjectType("ScheduleCalendarDayPayload")
export class ScheduleCalendarDayPayload {
  @Field(() => ScheduleCalendarDayModel)
  item!: ScheduleCalendarDayModel;
}

@ObjectType("DeleteScheduleCalendarDayPayload")
export class DeleteScheduleCalendarDayPayload {
  @Field(() => ID)
  id!: string;
}
