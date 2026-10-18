import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../data-scope/json-object.scalar";
import { DemoItemOneModel, DemoItemOneUserRef } from "./demo-item-one.model";

/** 清單分頁(GQL-03 的 `items` + `totalCount`;分頁參數用全站現況的 page / pageSize)。 */
@ObjectType()
export class DemoItemsOnePayload {
  @Field(() => [DemoItemOneModel])
  items!: DemoItemOneModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

/** 單筆查詢與全部寫入 mutation 的回傳(GQL-02:mutation 一律回 payload type)。 */
@ObjectType()
export class DemoItemOnePayload {
  @Field(() => DemoItemOneModel)
  item!: DemoItemOneModel;
}

/**
 * 刪除(軟刪除,ADR-0007):資料已不在清單上,只回被刪的 id 讓前端把那一列從快取拿掉。
 *
 * **每個模組各有一個**,不共用 orgs 的 `DeletePayload`:code-first 的 type 名是**全域唯一**的,
 * 共用會讓兩個模組的回傳形狀被綁在一起(其中一邊要加欄位就動到另一邊)。
 */
@ObjectType()
export class DeleteDemoItemOnePayload {
  @Field(() => Boolean)
  success!: boolean;

  @Field(() => ID)
  deletedId!: string;
}

/**
 * 變更歷程的一筆(`audit_logs` 的投影;需 `demo.sub.sample-one.edit-page.show-history`)。
 *
 * api 介面(GQL-07):
 * - `action`:審計動作名(`demo-item-one.create` / `.edit` / `.delete` / `.toggle-enabled`)
 * - `before` / `after`:只放**有變的欄位**;`internalNote` 一律不記內容(記一個遮罩字串),
 *   否則沒有 `show-internal-note` 的人會從歷程讀到內部備註
 */
@ObjectType()
export class DemoItemOneHistoryEntry {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  action!: string;

  /** 執行者;使用者已被刪除時為 null。 */
  @Field(() => DemoItemOneUserRef, { nullable: true })
  actor!: DemoItemOneUserRef | null;

  @Field(() => GraphQLJSONObject, { nullable: true })
  before!: Record<string, unknown> | null;

  @Field(() => GraphQLJSONObject, { nullable: true })
  after!: Record<string, unknown> | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

/** 變更歷程清單(GQL-03;新到舊,不分頁 —— 一筆資料的歷程量小)。 */
@ObjectType()
export class DemoItemOneHistoryPayload {
  @Field(() => [DemoItemOneHistoryEntry])
  items!: DemoItemOneHistoryEntry[];

  @Field(() => Int)
  totalCount!: number;
}

/**
 * 私有檔案的下載網址(ADR-0010:短效簽名,TTL `GCS_SIGNED_URL_TTL`)。
 * 每次要下載就再要一次,前端不要把它存進快取當成穩定連結。
 * 型別名帶模組前綴(GQL-02,由 `SignedUrlPayload` 改名)。
 */
@ObjectType()
export class DemoItemOneAttachmentUrlPayload {
  @Field(() => String)
  url!: string;
}
