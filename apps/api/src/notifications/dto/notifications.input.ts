import { Field, ID, InputType, Int } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../data-scope/json-object.scalar";

/** 清單分頁預設值(GQL-03)。 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** 我的通知清單:依時間新到舊;`unreadOnly` = 只列未讀(「全部 / 未讀」切換)。 */
@InputType()
export class MyNotificationsInput {
  /** 缺席 / null / false = 全部;true = 只列未讀 */
  @Field(() => Boolean, { nullable: true })
  unreadOnly?: boolean | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 標已讀:只動自己的未讀通知;別人的或不存在的 id 略過、不報錯。 */
@InputType()
export class MarkNotificationsReadInput {
  @Field(() => [ID])
  ids!: string[];
}

/** 通知設定清單:關鍵字比對類型名稱與 key。 */
@InputType()
export class NotificationSettingsInput {
  @Field(() => String, { nullable: true })
  keyword?: string | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/**
 * 改某個負責人提醒類型的收件人:`audience` 是人員條件(`@repo/domain/audience` 的形狀;
 * 不能「所有人」、不含所屬組織欄,使用者 / 角色須屬本租戶)。
 */
@InputType()
export class UpdateNotificationSettingInput {
  @Field()
  type!: string;

  @Field(() => GraphQLJSONObject)
  audience!: Record<string, unknown>;
}

/** 還原預設:之後用類型宣告的預設人員條件。 */
@InputType()
export class ResetNotificationSettingInput {
  @Field()
  type!: string;
}
