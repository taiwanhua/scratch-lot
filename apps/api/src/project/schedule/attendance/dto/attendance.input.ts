import { Field, GraphQLISODateTime, ID, InputType } from "@nestjs/graphql";

@InputType()
export class ScheduleAttendanceByPersonInput {
  /** 人員選單的分店;沒給 = 當前組織 */
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** 看誰;沒給 = 自己(看別人要 `view-all`) */
  @Field(() => ID, { nullable: true })
  userId?: string | null;

  /** 那個月的時點區間 `[月初 00:00, 下月初 00:00)`(租戶時區);不是整個月 → `VALIDATION_FAILED`(`from`、`to`) */
  @Field(() => GraphQLISODateTime)
  from!: Date;

  @Field(() => GraphQLISODateTime)
  to!: Date;
}

@InputType()
export class ScheduleAttendanceByStoreInput {
  /** 分店;沒給 = 當前組織 */
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** 那天(時點;租戶時區那天的 00:00,送當天其他時刻也歸到同一天) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  /** 只看未對應排班的打卡 */
  @Field(() => Boolean, { nullable: true })
  unmatchedOnly?: boolean | null;
}

@InputType()
export class ScheduleAttendanceExportInput {
  /** 那個月的時點區間 `[月初 00:00, 下月初 00:00)`(租戶時區);不是整個月 → `VALIDATION_FAILED`(`from`、`to`) */
  @Field(() => GraphQLISODateTime)
  from!: Date;

  @Field(() => GraphQLISODateTime)
  to!: Date;

  /** 分店(含看得到的下層分店,一家一個工作表);沒給 = 當前組織 */
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** 只匯出這個人(依人員(月));沒給 = 這些分店全部的人(沒有 `view-all` 時只有自己) */
  @Field(() => ID, { nullable: true })
  userId?: string | null;
}

@InputType()
export class ReassignSchedulePunchInput {
  @Field(() => ID)
  punchId!: string;

  /** 改對應到哪一筆排班;null = 改成未對應排班 */
  @Field(() => ID, { nullable: true })
  entryId?: string | null;

  /** 改對應排班原因(欄位管理「改對應排班原因」;必填) */
  @Field(() => String)
  reasonKey!: string;

  /** 說明(選「其他」必填) */
  @Field(() => String, { nullable: true })
  reasonNote?: string | null;
}

@InputType()
export class MakeupPunchEntryOptionsInput {
  /** 補打卡的時點(列出本人那天在那家店的排班,含前一天跨午夜到這天的班) */
  @Field(() => GraphQLISODateTime)
  at!: Date;

  @Field(() => ID)
  orgId!: string;
}
