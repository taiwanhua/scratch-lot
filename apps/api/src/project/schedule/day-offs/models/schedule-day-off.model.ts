import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 一段畫休(本人的,或總覽 / 當天詳細裡的某個人)。 */
@ObjectType("ScheduleDayOff")
export class ScheduleDayOffModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  userId!: string;

  /** 人名(使用者名稱) */
  @Field(() => String)
  name!: string;

  /** `YYYY-MM-DD` */
  @Field(() => String)
  date!: string;

  /** `full-day` 整天畫休 / `time-range` 時段不可排 */
  @Field(() => String)
  kind!: string;

  /** 時段不可排的開始 / 結束(`HH:mm`);整天畫休為 null */
  @Field(() => String, { nullable: true })
  startTime!: string | null;

  @Field(() => String, { nullable: true })
  endTime!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** 以這家店為主要分店(同日畫休人數只計這些人) */
  @Field(() => Boolean)
  isPrimary!: boolean;

  /** 代改人的名稱;本人登記為 null */
  @Field(() => String, { nullable: true })
  byName!: string | null;

  /** 代改原因(選項 value)與「其他」的說明 */
  @Field(() => String, { nullable: true })
  reason!: string | null;

  @Field(() => String, { nullable: true })
  reasonNote!: string | null;
}

/** 某個月的畫休開放期間(這家店的規則「畫休開放期間」;登記的是下個月)。 */
@ObjectType("ScheduleDayOffWindow")
export class ScheduleDayOffWindowModel {
  /** 目標月 `YYYY-MM` */
  @Field(() => String)
  month!: string;

  /** `YYYY-MM-DD`(含頭尾) */
  @Field(() => String)
  startDate!: string;

  @Field(() => String)
  endDate!: string;

  /** `before` 還沒開始 / `open` 開放中 / `closed` 已截止(以租戶時區的今天判斷) */
  @Field(() => String)
  state!: string;

  /** 開放中還剩幾天(含今天);其他狀態為 0 */
  @Field(() => Int)
  daysLeft!: number;
}

/** 某一天:同日畫休人數與畫休的人。 */
@ObjectType("ScheduleDayOffDay")
export class ScheduleDayOffDayModel {
  @Field(() => String)
  date!: string;

  /** 同日畫休人數(只計以這家店為主要分店的人;整天或時段不可排都算 1 人) */
  @Field(() => Int)
  staffCount!: number;

  /** 那天的畫休(依人、時間) */
  @Field(() => [ScheduleDayOffModel])
  dayOffs!: ScheduleDayOffModel[];
}

/** 一筆違反(規則檢查函式的結果;畫面依 `key` 與數字組文案)。 */
@ObjectType("ScheduleDayOffViolation")
export class ScheduleDayOffViolationModel {
  /** 規則 key(例 `maxMonthlyDayOffs`) */
  @Field(() => String)
  key!: string;

  /** `limit` 限制 / `reminder` 提醒 */
  @Field(() => String)
  level!: string;

  /** 給人看的說明(api 端的中文) */
  @Field(() => String)
  message!: string;

  /** 違反涉及的日期(色帶畫在這些日子;[查看] 跳到第一天) */
  @Field(() => [String])
  dates!: string[];

  @Field(() => Int, { nullable: true })
  actual!: number | null;

  @Field(() => Int, { nullable: true })
  limit!: number | null;

  /** 期間類(連續休假、某一天)的起訖 `YYYY-MM-DD` */
  @Field(() => String, { nullable: true })
  from!: string | null;

  @Field(() => String, { nullable: true })
  to!: string | null;
}

/** 規則的數字(統計列「已畫 4 天 · 上限 8 · 下限 4」、同日「2/2」);規則關掉為 null。 */
@ObjectType("ScheduleDayOffLimits")
export class ScheduleDayOffLimitsModel {
  @Field(() => Int, { nullable: true })
  maxMonthly!: number | null;

  @Field(() => Int, { nullable: true })
  minMonthly!: number | null;

  /** 同日最多畫休人數 */
  @Field(() => Int, { nullable: true })
  maxDailyStaff!: number | null;
}

@ObjectType("ScheduleDayOffOrg")
export class ScheduleDayOffOrgModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/** 我的畫休(SC-02 / SC-23)。 */
@ObjectType("MyScheduleDayOffsPayload")
export class MyScheduleDayOffsPayload {
  @Field(() => String)
  month!: string;

  /** 主要分店(規則用它的設定、同日人數算它);還沒加入排班為 null */
  @Field(() => ScheduleDayOffOrgModel, { nullable: true })
  primaryOrg!: ScheduleDayOffOrgModel | null;

  @Field(() => ScheduleDayOffWindowModel, { nullable: true })
  window!: ScheduleDayOffWindowModel | null;

  /** 現在能不能自己登記 / 刪除這個月(開放中、這個月是目標月) */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 有代改權限(看得到畫休總覽且有 `edit-day-offs`):開放期間外顯示「到 [畫休總覽] 代改」 */
  @Field(() => Boolean)
  canOverride!: boolean;

  @Field(() => ScheduleDayOffLimitsModel)
  limits!: ScheduleDayOffLimitsModel;

  /** 這個月已畫幾天(那天有任何一種就算 1 天) */
  @Field(() => Int)
  dayOffCount!: number;

  /** 我這個月的畫休 */
  @Field(() => [ScheduleDayOffModel])
  myDayOffs!: ScheduleDayOffModel[];

  /** 主要分店這個月有畫休的日子(看得到誰,SC-42) */
  @Field(() => [ScheduleDayOffDayModel])
  days!: ScheduleDayOffDayModel[];

  /** 涉及我的違反(人的規則 + 我有畫休的那天超過同日人數) */
  @Field(() => [ScheduleDayOffViolationModel])
  violations!: ScheduleDayOffViolationModel[];
}

/** 總覽上的一位排班人員(「尚未畫休」篩選、代改選人)。 */
@ObjectType("ScheduleDayOffStaff")
export class ScheduleDayOffStaffModel {
  @Field(() => ID)
  userId!: string;

  @Field(() => String)
  name!: string;

  /** 以這家店為主要分店 */
  @Field(() => Boolean)
  isPrimary!: boolean;

  /** 這個月已畫幾天 */
  @Field(() => Int)
  dayOffCount!: number;
}

/** 畫休總覽(SC-06)。 */
@ObjectType("ScheduleDayOffOverviewPayload")
export class ScheduleDayOffOverviewPayload {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  @Field(() => String)
  month!: string;

  /** 這家店的開放期間(這個月是目標月時) */
  @Field(() => ScheduleDayOffWindowModel)
  window!: ScheduleDayOffWindowModel;

  /** 能不能 [代改](`schedule.manage.edit-day-offs`) */
  @Field(() => Boolean)
  canEdit!: boolean;

  @Field(() => ScheduleDayOffLimitsModel)
  limits!: ScheduleDayOffLimitsModel;

  /** 可以排這家店的排班人員(候選人) */
  @Field(() => [ScheduleDayOffStaffModel])
  staff!: ScheduleDayOffStaffModel[];

  /** 這個月有畫休的日子 */
  @Field(() => [ScheduleDayOffDayModel])
  days!: ScheduleDayOffDayModel[];
}

/** 登記 / 代改後:新增的畫休 + 存檔後仍有的提醒(限制不會存進來)。 */
/** 登記的畫休和這個人已有的排班重疊(畫休照樣存;提醒通知店長調整班表)。 */
@ObjectType("ScheduleDayOffEntryConflict")
export class ScheduleDayOffEntryConflictModel {
  /** 排班的日期 `YYYY-MM-DD` */
  @Field(() => String)
  date!: string;

  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  /** 排班的分店;操作者看不到那家店時為 null(畫面寫「其他分店」) */
  @Field(() => String, { nullable: true })
  orgName!: string | null;
}

@ObjectType("SaveScheduleDayOffsPayload")
export class SaveScheduleDayOffsPayload {
  @Field(() => [ScheduleDayOffModel])
  items!: ScheduleDayOffModel[];

  @Field(() => [ScheduleDayOffViolationModel])
  violations!: ScheduleDayOffViolationModel[];

  /** 和這個人已有的排班重疊的(跨店也算);畫休照樣存 */
  @Field(() => [ScheduleDayOffEntryConflictModel])
  entryConflicts!: ScheduleDayOffEntryConflictModel[];
}

@ObjectType("DeleteScheduleDayOffPayload")
export class DeleteScheduleDayOffPayload {
  @Field(() => ID)
  id!: string;
}
