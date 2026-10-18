import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

/**
 * 狀態(GQL-01:enum 值 SCREAMING_SNAKE_CASE)。
 * 成員值即落庫的字串,與 `database/schemas/demo-item-one.schema.ts` 的
 * `DEMO_ITEM_ONE_STATUSES` 以及 seed 宣告的資料範圍選項一一對應(ADR-0008 的 enum 欄位)。
 */
export enum DemoItemOneStatusEnum {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
}

registerEnumType(DemoItemOneStatusEnum, {
  name: "DemoItemOneStatus",
  description:
    "示範項目狀態(草稿 / 已發布 / 已封存);資料範圍規則的 enum 欄位,選項正本在模組 seed",
});

/** 使用者的最小參照(建立者、歷程的執行者)。 */
@ObjectType()
export class DemoItemOneUserRef {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/**
 * 附件(私有 bucket,ADR-0010)。
 * `path` 是物件路徑;**下載網址不在這裡** —— 要另外呼叫 `demoItemOneAttachmentUrl(id)` 現簽,
 * 才守得住「私有檔案的可取範圍 = 該筆資料的可查範圍」。
 *
 * `name` / `size` / `contentType` 是上傳時前端申報的原始值,原樣回傳。
 * **早期上傳的附件三者皆為 `null`**(當時只存路徑)—— 前端退回顯示路徑尾段、不顯示大小。
 */
@ObjectType()
export class DemoItemOneAttachment {
  @Field(() => ID)
  path!: string;

  /** 原始檔名(使用者選檔時的檔名);舊資料為 null。 */
  @Field(() => String, { nullable: true })
  name!: string | null;

  /** 檔案大小(bytes);舊資料為 null。 */
  @Field(() => Int, { nullable: true })
  size!: number | null;

  /** content type;舊資料為 null。 */
  @Field(() => String, { nullable: true })
  contentType!: string | null;
}

/**
 * 這筆資料**對這位操作者**允許的動作,由 api 依有效權限集算好(GQL-07)。
 *
 * **每個旗標都已經含權限判斷**(與前端對齊):前端**直接用**,不要再與
 * `usePermissions` 相乘 —— 那會讓同一條規則在兩邊各算一次,對不起來就是畫面與 API 不一致。
 * (與角色頁的 `RoleAbilities` 不同:那組刻意不含權限 key,因為它表達的是「角色種類規則」。)
 */
@ObjectType()
export class DemoItemOneAbilities {
  /** 持有 `demo.sub.sample-one.edit`:編輯按鈕直接依它顯示。 */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 持有 `demo.sub.sample-one.delete`:刪除按鈕直接依它顯示。 */
  @Field(() => Boolean)
  canDelete!: boolean;

  /**
   * 持有 `demo.sub.sample-one.edit-internal-note`(欄位級權限,綁父模組,ADR-0004)。
   * false 但 `internalNote` 有值 = 看得到、改不動(唯讀);硬送寫入回 `FORBIDDEN`
   * (reason `FIELD_FORBIDDEN`)。
   */
  @Field(() => Boolean)
  canEditInternalNote!: boolean;
}

/**
 * 示範項目(`demo.sub.sample-one` 的主要型別;技術文件 `docs/modules/demo.sub.sample-one.md`)。
 *
 * api 介面(GQL-07:欄位語意的正本在模組文件的「api 介面」節,此處與之對齊):
 * - `internalNote`:**欄位級權限**。沒有 `demo.sub.sample-one.show-internal-note` 時
 *   api 根本不把這個欄位放進回傳物件(GraphQL 序列化成 `null`),所以「沒權限」與「沒填」
 *   在線上看起來一樣 —— 前端依**自己的權限集**決定要不要渲染這個欄位,不靠值去猜
 * - `coverUrl`:公開 bucket 的**穩定** URL(不過期,可直接放 `<img src>`);沒有封面時 null
 * - `attachment`:私有 bucket,**只給路徑與原始檔名 / 大小 / 檔型**,下載網址另呼叫 `demoItemOneAttachmentUrl(id)`
 * - `categoryLabel`:`category`(存 value)在欄位管理「示範分類」**操作者合併範圍**內對應的
 *   顯示名稱;分類已被停用 / 屬於看不到的組織時為 null(值仍原樣回在 `category`)
 * - `createdBy`:建立者;**查不到那位使用者時一律回 `null`,不拋錯** —— seed 的示範資料用假的
 *   ObjectId 當建立者,真實環境也會有使用者被刪掉的情形,前端顯示「—」即可
 */
@ObjectType("DemoItemOne")
export class DemoItemOneModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  category!: string | null;

  @Field(() => String, { nullable: true })
  categoryLabel!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => String, { nullable: true })
  internalNote?: string | null;

  /** 封面的物件路徑(公開 bucket);編輯時原樣送回即「不換圖」。 */
  @Field(() => ID, { nullable: true })
  coverPath!: string | null;

  @Field(() => String, { nullable: true })
  coverUrl!: string | null;

  @Field(() => DemoItemOneAttachment, { nullable: true })
  attachment!: DemoItemOneAttachment | null;

  @Field(() => DemoItemOneStatusEnum)
  status!: DemoItemOneStatusEnum;

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => DemoItemOneUserRef, { nullable: true })
  createdBy!: DemoItemOneUserRef | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => DemoItemOneAbilities)
  abilities!: DemoItemOneAbilities;
}
