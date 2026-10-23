import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 一張打卡(出勤紀錄的上下班卡、未對應排班的卡;[改對應排班] 用 `id`)。 */
@ObjectType("ScheduleAttendancePunch")
export class ScheduleAttendancePunchModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  userId!: string;

  @Field(() => String)
  userName!: string;

  /** 打卡的分店 */
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** `in` 上班 / `out` 下班 */
  @Field(() => String)
  type!: string;

  @Field(() => GraphQLISODateTime)
  at!: Date;

  /** 對應排班;null = 未對應排班 */
  @Field(() => ID, { nullable: true })
  entryId!: string | null;

  /** `button` 按鈕 / `makeup` 補打卡 */
  @Field(() => String)
  source!: string;

  /** 重複打卡 */
  @Field(() => Boolean)
  duplicate!: boolean;
}

/** 一筆排班的出勤(規格 14.7)。 */
@ObjectType("ScheduleAttendanceRow")
export class ScheduleAttendanceRowModel {
  @Field(() => ID)
  entryId!: string;

  @Field(() => ID)
  userId!: string;

  @Field(() => String)
  userName!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 那天(上班時點在租戶時區那天的 00:00;跨午夜算開始那天) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => Int)
  breakMinutes!: number;

  /** 範本簡稱;未套用範本 = null(畫面顯示「臨」) */
  @Field(() => String, { nullable: true })
  shortName!: string | null;

  /** 生效的上班卡 / 下班卡時點 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  clockIn!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  clockOut!: Date | null;

  /** `arrived` 已到 / `absent` 未到 / `upcoming` 未開始 */
  @Field(() => String)
  status!: string;

  /** 遲到幾分(0 = 沒遲到;寬限用班所在分店的規則) */
  @Field(() => Int)
  lateMinutes!: number;

  @Field(() => Int)
  earlyLeaveMinutes!: number;

  /** 實際工時(分)= 下班 − 上班 − 休息;缺卡 = null */
  @Field(() => Int, { nullable: true })
  workedMinutes!: number | null;

  /** 排班工時(分) */
  @Field(() => Int)
  scheduledMinutes!: number;

  /** 缺的卡(只算已結束的班):`in` / `out` */
  @Field(() => [String])
  missing!: string[];

  /** 那天的特殊日名稱(行事曆;沒有 = null) */
  @Field(() => String, { nullable: true })
  specialDayName!: string | null;

  /** 那天的特殊日類別(欄位管理的名稱;沒有 = null) */
  @Field(() => String, { nullable: true })
  specialDayCategory!: string | null;

  /** 有補打卡寫入的卡(補卡註記) */
  @Field(() => Boolean)
  hasMakeup!: boolean;

  /** 這一班的所有打卡(含重複打卡) */
  @Field(() => [ScheduleAttendancePunchModel])
  punches!: ScheduleAttendancePunchModel[];
}

/** 人員選單的一個人。 */
@ObjectType("ScheduleAttendancePerson")
export class ScheduleAttendancePersonModel {
  @Field(() => ID)
  userId!: string;

  @Field(() => String)
  name!: string;
}

/** 這位操作者在出勤紀錄能做的事(api 算好、前端只讀)。 */
@ObjectType("ScheduleAttendanceAbilities")
export class ScheduleAttendanceAbilitiesModel {
  /** `view-all` 看全部(沒有時只看自己的) */
  @Field(() => Boolean)
  canViewAll!: boolean;

  /** `reassign-punches` 改對應排班 */
  @Field(() => Boolean)
  canReassign!: boolean;

  /** `export` 匯出 Excel */
  @Field(() => Boolean)
  canExport!: boolean;

  /** `create` 補打卡申請 */
  @Field(() => Boolean)
  canCreate!: boolean;
}

/** 出勤紀錄 → 依人員(月)。 */
@ObjectType("ScheduleAttendanceByPersonPayload")
export class ScheduleAttendanceByPersonPayload {
  /** `YYYY-MM` */
  @Field(() => String)
  month!: string;

  @Field(() => ID)
  orgId!: string;

  /** 看的是誰 */
  @Field(() => ID)
  userId!: string;

  /** 人員選單:有 `view-all` = 這家店的排班人員;沒有 = 只有自己 */
  @Field(() => [ScheduleAttendancePersonModel])
  people!: ScheduleAttendancePersonModel[];

  @Field(() => [ScheduleAttendanceRowModel])
  rows!: ScheduleAttendanceRowModel[];

  /** 這個月這個人未對應排班的打卡 */
  @Field(() => [ScheduleAttendancePunchModel])
  unmatched!: ScheduleAttendancePunchModel[];

  @Field(() => ScheduleAttendanceAbilitiesModel)
  abilities!: ScheduleAttendanceAbilitiesModel;
}

/** 出勤紀錄 → 依分店(日)。 */
@ObjectType("ScheduleAttendanceByStorePayload")
export class ScheduleAttendanceByStorePayload {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 那天(租戶時區 00:00 的時點) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  /** 當天排班的人(只看未對應排班的打卡時是空的) */
  @Field(() => [ScheduleAttendanceRowModel])
  rows!: ScheduleAttendanceRowModel[];

  /** 當天在這家店打的、未對應排班的卡 */
  @Field(() => [ScheduleAttendancePunchModel])
  unmatched!: ScheduleAttendancePunchModel[];

  /** 排班人數 / 已到 / 未到(不受「只看未對應排班的打卡」影響) */
  @Field(() => Int)
  scheduledCount!: number;

  @Field(() => Int)
  arrivedCount!: number;

  @Field(() => Int)
  absentCount!: number;

  @Field(() => ScheduleAttendanceAbilitiesModel)
  abilities!: ScheduleAttendanceAbilitiesModel;
}

/** Excel 的一個工作表 = 一家分店。 */
@ObjectType("ScheduleAttendanceExportSheet")
export class ScheduleAttendanceExportSheetModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  @Field(() => [ScheduleAttendanceRowModel])
  rows!: ScheduleAttendanceRowModel[];
}

@ObjectType("ScheduleAttendanceExportPayload")
export class ScheduleAttendanceExportPayload {
  /** `YYYY-MM` */
  @Field(() => String)
  month!: string;

  /** 一家分店一個(依分店名稱排序;沒有排班的分店不列) */
  @Field(() => [ScheduleAttendanceExportSheetModel])
  sheets!: ScheduleAttendanceExportSheetModel[];
}

/** [改對應排班] 可以選的排班(這個人打卡那天前後各一天的班)。 */
@ObjectType("ScheduleAttendanceEntryOption")
export class ScheduleAttendanceEntryOptionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 那天(上班時點在租戶時區那天的 00:00;跨午夜算開始那天) */
  @Field(() => GraphQLISODateTime)
  date!: Date;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  /** 範本簡稱;未套用範本 = null(畫面顯示「臨」) */
  @Field(() => String, { nullable: true })
  shortName!: string | null;
}
