import { Field, ID, Int, ObjectType } from "@nestjs/graphql";

/** 排班人員可以排的一家分店(只列操作者看得到的分店)。 */
@ObjectType("ScheduleStaffOrg")
export class ScheduleStaffOrgModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 可擔任負責人 */
  @Field(() => Boolean)
  canLead!: boolean;

  /** 主要分店(每人一家;人的規則用主要分店的設定) */
  @Field(() => Boolean)
  isPrimary!: boolean;

  @Field(() => Int)
  sortOrder!: number;
}

/** 排班檔案(已加入排班的人才有)。 */
@ObjectType("ScheduleStaffProfile")
export class ScheduleStaffProfileModel {
  @Field(() => ID)
  id!: string;

  /** `full-time` 正職 / `part-time` 兼職 */
  @Field(() => String)
  employmentType!: string;

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** 可以排的分店(操作者看得到的那幾家,依 sortOrder) */
  @Field(() => [ScheduleStaffOrgModel])
  orgs!: ScheduleStaffOrgModel[];

  /** 主要分店在操作者看不到的分店(這時不能在看得到的分店再設主要分店) */
  @Field(() => Boolean)
  primaryElsewhere!: boolean;

  /**
   * 別店建的檔案、因為「可以排的分店」有我看得到的店才看得到(資料共用,ADR-0014):只能看,
   * 改了回 `FORBIDDEN`(`NOT_OWNER`)。
   */
  @Field(() => Boolean)
  isShared!: boolean;
}

/** 排班人員頁的一列:使用者 + 排班檔案(未加入為 null)。 */
@ObjectType("ScheduleStaffRow")
export class ScheduleStaffRowModel {
  @Field(() => ID)
  userId!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  account!: string;

  /**
   * 已被操作者**完全看不到**的檔案加入排班(一人一份;別店建、可以排的分店也沒有我看得到的店):
   * 不能再 [加入排班],`staff` 為 null。看得到但不歸自己的,`staff.isShared = true`。
   */
  @Field(() => Boolean)
  joinedElsewhere!: boolean;

  @Field(() => ScheduleStaffProfileModel, { nullable: true })
  staff!: ScheduleStaffProfileModel | null;
}

@ObjectType("ScheduleStaffListPayload")
export class ScheduleStaffListPayload {
  @Field(() => [ScheduleStaffRowModel])
  items!: ScheduleStaffRowModel[];

  @Field(() => Int)
  totalCount!: number;

  /** 操作者能不能 [加入排班] / 改設定(`schedule.settings.edit-staff`) */
  @Field(() => Boolean)
  canEdit!: boolean;
}

@ObjectType("AddScheduleStaffPayload")
export class AddScheduleStaffPayload {
  @Field(() => [ScheduleStaffRowModel])
  items!: ScheduleStaffRowModel[];
}

@ObjectType("ScheduleStaffPayload")
export class ScheduleStaffPayload {
  @Field(() => ScheduleStaffRowModel)
  item!: ScheduleStaffRowModel;
}
