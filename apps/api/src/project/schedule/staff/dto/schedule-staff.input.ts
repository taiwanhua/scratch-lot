import { Field, ID, InputType } from "@nestjs/graphql";

/** 排班人員頁:`joined` 缺席或 null = 全部、true = 已加入、false = 未加入;`keyword` 比對姓名與帳號。 */
@InputType()
export class ScheduleStaffListInput {
  @Field(() => Boolean, { nullable: true })
  joined?: boolean | null;

  @Field(() => String, { nullable: true })
  keyword?: string | null;
}

/** [加入排班]:勾選的使用者(都要是還沒加入的)。 */
@InputType()
export class AddScheduleStaffInput {
  @Field(() => [ID])
  userIds!: string[];
}

/** 可以排的一家分店。 */
@InputType()
export class ScheduleStaffOrgInput {
  @Field(() => ID)
  orgId!: string;

  @Field(() => Boolean)
  canLead!: boolean;

  @Field(() => Boolean)
  isPrimary!: boolean;
}

/**
 * 排班人員設定(GQL-06):缺席 = 不動。
 * `orgs`:**操作者看得到的分店**整份取代(順序 = 排序);看不到的分店的關聯保留不動。
 * `note`:`null` = 清空。
 */
@InputType()
export class UpdateScheduleStaffInput {
  @Field(() => ID)
  staffId!: string;

  @Field(() => String, { nullable: true })
  employmentType?: string;

  @Field(() => Boolean, { nullable: true })
  enabled?: boolean;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => [ScheduleStaffOrgInput], { nullable: true })
  orgs?: ScheduleStaffOrgInput[];
}
