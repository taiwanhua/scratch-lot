import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
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
  page!: number;

  @Field(() => Int)
  pageSize!: number;

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

/** 通知設定頁的一列(一種負責人提醒類型)。 */
@ObjectType("NotificationSetting")
export class NotificationSettingModel {
  @Field()
  type!: string;

  @Field()
  name!: string;

  @Field(() => NotificationOrgScopeModel)
  orgScope!: NotificationOrgScopeModel;

  /** 目前生效的人員條件(租戶調整過的,或類型宣告的預設) */
  @Field(() => GraphQLJSONObject)
  audience!: Record<string, unknown>;

  /** true = 沒有調整,用類型宣告的預設 */
  @Field()
  isDefault!: boolean;

  /** 類型宣告的預設人員條件(「還原預設」後會變回它) */
  @Field(() => GraphQLJSONObject)
  defaultAudience!: Record<string, unknown>;

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
