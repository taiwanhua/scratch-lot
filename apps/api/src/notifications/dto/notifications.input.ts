import { Field, ID, InputType, Int, registerEnumType } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../data-scope/json-object.scalar";
import { NotificationScheduleKindEnum } from "../models/notifications.model";

/** 清單分頁預設值(GQL-03)。 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * 我的通知清單:依時間新到舊;`unreadOnly` = 只列未讀(「全部 / 未讀」切換)。
 * 以游標分頁(GQL-03 的例外):`after` 帶上一批回傳的 `nextCursor`,接著列比它舊的。
 */
@InputType()
export class MyNotificationsInput {
  /** 缺席 / null / false = 全部;true = 只列未讀 */
  @Field(() => Boolean, { nullable: true })
  unreadOnly?: boolean | null;

  @Field(() => String, {
    nullable: true,
    description:
      "上一批回傳的 nextCursor;缺席 / null = 從最新的開始。格式不對 → VALIDATION_FAILED(reason INVALID_CURSOR)",
  })
  after?: string | null;

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

/**
 * 通知設定清單:關鍵字比對類型名稱(登記的繁中 `name`)與 key;
 * `nameMatchedTypes` 是前端以畫面上的顯示名稱(訊息檔,依介面語言)比中的類型 key,與關鍵字的比對取聯集。
 */
@InputType()
export class NotificationSettingsInput {
  @Field(() => String, { nullable: true })
  keyword?: string | null;

  @Field(() => [String], {
    nullable: true,
    description:
      "前端以顯示名稱比中 keyword 的類型 key(與 keyword 比對 name / key 的結果取聯集;沒給 keyword 時不影響清單)",
  })
  nameMatchedTypes?: string[] | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 提醒時間:`kind` 必須是類型宣告的寫法,只給該寫法的欄位。 */
@InputType()
export class NotificationScheduleInput {
  @Field(() => NotificationScheduleKindEnum)
  kind!: NotificationScheduleKindEnum;

  /** `DAYS_BEFORE`:提前天數 0–365、1–5 個、不重複 */
  @Field(() => [Int], { nullable: true })
  daysBefore?: number[] | null;

  /** `MONTHLY`:每月第幾天 1–31 */
  @Field(() => Int, { nullable: true })
  dayOfMonth?: number | null;

  /** `HH:mm`,15 分鐘一格 */
  @Field()
  time!: string;
}

/**
 * 改某個類型的收件人及 / 或提醒時間(缺席或 null = 不動;兩個都沒給 → `NOTHING_TO_UPDATE`):
 * `audience` 是人員條件(`@repo/domain/audience` 的形狀;不能「所有人」、不含所屬組織欄,
 * 使用者 / 角色須屬本租戶;當事人通知不能給);`schedule` 只有宣告了可調時間的類型能給。
 */
@InputType()
export class UpdateNotificationSettingInput {
  @Field()
  type!: string;

  @Field(() => GraphQLJSONObject, { nullable: true })
  audience?: Record<string, unknown> | null;

  @Field(() => NotificationScheduleInput, { nullable: true })
  schedule?: NotificationScheduleInput | null;
}

/** 還原預設的範圍(內部值是 service 的小寫字串)。 */
export enum NotificationSettingPartEnum {
  AUDIENCE = "audience",
  SCHEDULE = "schedule",
}

registerEnumType(NotificationSettingPartEnum, {
  name: "NotificationSettingPart",
  description: "還原預設的範圍:收件人 / 提醒時間",
});

/** 還原預設:`part` 那一部分改回類型宣告的預設;缺席或 null = 這個類型可調的部分全部還原。 */
@InputType()
export class ResetNotificationSettingInput {
  @Field()
  type!: string;

  @Field(() => NotificationSettingPartEnum, { nullable: true })
  part?: NotificationSettingPartEnum | null;
}
