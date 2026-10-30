import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../data-scope/json-object.scalar";

/** 我的一則通知(只列站內通知)。 */
@ObjectType("Notification")
export class NotificationModel {
  @Field(() => ID)
  id!: string;

  /** 通知類型 key(例 `workflow.result`) */
  @Field()
  type!: string;

  @Field()
  title!: string;

  @Field()
  body!: string;

  @Field(() => String, { nullable: true })
  refType!: string | null;

  @Field(() => String, { nullable: true })
  refId!: string | null;

  /** 連結登記表換成的 admin 站內路徑(例 `/apply-center/view-page/<id>`);沒有連結 = null */
  @Field(() => String, { nullable: true })
  link!: string | null;

  /** null = 未讀 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  readAt!: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class MyNotificationsPayload {
  @Field(() => [NotificationModel])
  items!: NotificationModel[];

  @Field(() => Int)
  pageSize!: number;

  /** 下一批的游標(送回 `after`);沒有更多 = null */
  @Field(() => String, { nullable: true })
  nextCursor!: string | null;

  @Field(() => Int)
  totalCount!: number;

  /** 目前的未讀數(與 `myNotificationUnreadCount` 同一個數) */
  @Field(() => Int)
  unreadCount!: number;
}

@ObjectType()
export class MyNotificationUnreadCountPayload {
  @Field(() => Int)
  count!: number;
}

/** 標已讀 / 全部標已讀之後的未讀數。 */
@ObjectType()
export class MarkNotificationsReadPayload {
  @Field(() => Int)
  unreadCount!: number;
}

/** 一個管道的開關(個人設定的偏好分頁)。 */
@ObjectType()
export class NotificationChannelPreference {
  /** 管道 key(`in-app`、`email`) */
  @Field()
  channel!: string;

  /** 存在個人偏好裡的 key(`updateMyPreferences` 用它開關) */
  @Field()
  preferenceKey!: string;

  @Field()
  enabled!: boolean;

  /** false = 不能關(開關停用;送關閉 → `VALIDATION_FAILED`) */
  @Field()
  canDisable!: boolean;
}

/** 一種通知類型與它的管道開關。 */
@ObjectType()
export class NotificationTypePreference {
  @Field()
  type!: string;

  /** 顯示名稱(繁中預設;前端可依 type 從訊息檔覆寫) */
  @Field()
  name!: string;

  @Field(() => [NotificationChannelPreference])
  channels!: NotificationChannelPreference[];
}

@ObjectType()
export class MyNotificationPreferencesPayload {
  @Field(() => [NotificationTypePreference])
  items!: NotificationTypePreference[];
}

/** 負責人提醒的組織範圍(類型宣告、唯讀)。 */
@ObjectType("NotificationOrgScope")
export class NotificationOrgScopeModel {
  /** `event-org`(事件的組織)或 `tenant`(租戶) */
  @Field()
  ref!: string;

  /** `self` / `descendants` / `ancestors`(本身 / 含下層 / 含上層) */
  @Field()
  range!: string;
}

/**
 * 提醒時間的寫法(GraphQL 值 SCREAMING_SNAKE_CASE,內部值是存進資料庫的字串;GQL-01)。
 */
export enum NotificationScheduleKindEnum {
  DAYS_BEFORE = "days-before",
  DAILY_OVERDUE = "daily-overdue",
  MONTHLY = "monthly",
}

registerEnumType(NotificationScheduleKindEnum, {
  name: "NotificationScheduleKind",
  description:
    "提醒時間的寫法:某日期前 N 天(可多個)/ 逾期後每天 / 每月第 N 天;由類型宣告,租戶不能換",
});

/** 提醒時間(時間一律以租戶時區計)。 */
@ObjectType("NotificationSchedule")
export class NotificationScheduleModel {
  @Field(() => NotificationScheduleKindEnum)
  kind!: NotificationScheduleKindEnum;

  /** `DAYS_BEFORE` 才有:提前天數(0 = 當天);其他寫法 = null */
  @Field(() => [Int], { nullable: true })
  daysBefore!: number[] | null;

  /** `MONTHLY` 才有:每月第幾天(1–31,沒有這一天用月底);其他寫法 = null */
  @Field(() => Int, { nullable: true })
  dayOfMonth!: number | null;

  /** 寄送時間 `HH:mm`(15 分鐘一格) */
  @Field()
  time!: string;
}

/** 通知設定頁的一列:一種負責人提醒,或宣告了可調時間的當事人通知。 */
@ObjectType("NotificationSetting")
export class NotificationSettingModel {
  @Field()
  type!: string;

  @Field()
  name!: string;

  /** `responsible`(負責人提醒)/ `party`(當事人通知) */
  @Field()
  category!: string;

  /** 負責人提醒的組織範圍;當事人通知 = null */
  @Field(() => NotificationOrgScopeModel, { nullable: true })
  orgScope!: NotificationOrgScopeModel | null;

  /** 目前生效的人員條件(租戶調整過的,或類型宣告的預設);當事人通知 = null */
  @Field(() => GraphQLJSONObject, { nullable: true })
  audience!: Record<string, unknown> | null;

  /** true = 收件人沒有調整,用類型宣告的預設;當事人通知一律 true */
  @Field()
  isDefault!: boolean;

  /** 類型宣告的預設人員條件(「還原預設」後會變回它);當事人通知 = null */
  @Field(() => GraphQLJSONObject, { nullable: true })
  defaultAudience!: Record<string, unknown> | null;

  /** 當事人通知的收件人說明(類型宣告,例「處理這件事的人員」);沒有 = null */
  @Field(() => String, { nullable: true })
  recipientNote!: string | null;

  /** 目前生效的提醒時間;沒宣告可調時間 = null(事件發生時就寄) */
  @Field(() => NotificationScheduleModel, { nullable: true })
  schedule!: NotificationScheduleModel | null;

  /** 類型宣告的預設提醒時間;沒宣告 = null */
  @Field(() => NotificationScheduleModel, { nullable: true })
  defaultSchedule!: NotificationScheduleModel | null;

  /** true = 提醒時間沒有調整;沒宣告可調時間一律 true */
  @Field()
  isScheduleDefault!: boolean;

  /** `DAYS_BEFORE` 的日期稱呼(類型宣告,例「到期」);沒有 = null */
  @Field(() => String, { nullable: true })
  scheduleDateLabel!: string | null;

  /** 最後一次調整 / 還原的時間;從沒動過 = null */
  @Field(() => GraphQLISODateTime, { nullable: true })
  updatedAt!: Date | null;

  @Field(() => ID, { nullable: true })
  updatedBy!: string | null;
}

@ObjectType()
export class NotificationSettingsPayload {
  @Field(() => [NotificationSettingModel])
  items!: NotificationSettingModel[];

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;

  @Field(() => Int)
  totalCount!: number;
}

@ObjectType()
export class NotificationSettingPayload {
  @Field(() => NotificationSettingModel)
  setting!: NotificationSettingModel;
}
