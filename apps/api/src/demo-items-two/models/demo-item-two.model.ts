import { Field, GraphQLISODateTime, ID, ObjectType } from "@nestjs/graphql";

import { ShareOrgModel } from "../../sharing/share-org.model";

/**
 * 建立者的最小參照(示範模組2 只需要 id 與顯示名)。
 *
 * **查無此人時整個 `createdBy` 為 null**:示範資料的建立者是假 id
 * (`apps/db-migrator/seeds/base/demo-items.ts` 說明了為什麼),使用者自己新增的那幾筆才查得到人。
 */
@ObjectType("DemoItemTwoUser")
export class DemoItemTwoUserModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/**
 * 這一筆**對這位操作者**允許的兩個動作(與角色頁的 `Role.abilities` 同型,api 算好、前端只讀)。
 *
 * 示範模組2 沒有種類規則、沒有欄位級權限,所以這兩個布林就等於「操作者有沒有那個權限 key」;
 * 它仍然由 api 回,是為了讓前端的列表與詳情頁**不必自己拼權限判斷** —— 前端顯示按鈕的條件
 * 就是 `item.abilities.canEdit`,不再 `usePermissions` 相乘(示範模組1 的欄位級 abilities 同型)。
 */
@ObjectType("DemoItemTwoAbilities")
export class DemoItemTwoAbilitiesModel {
  /**
   * 編輯與切換停用 / 啟用(`demo.sample-two.edit`);**共用進來的資料一律 false**
   * (歸屬組織不在操作者可見範圍內 —— 共用只放寬讀,ADR-0014)。
   */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 刪除(`demo.sample-two.delete`;軟刪除);共用進來的資料一律 false。 */
  @Field(() => Boolean)
  canDelete!: boolean;
}

/**
 * 示範模組2 的項目(對照組;完整示範見 `DemoItemOne`)。
 *
 * api 介面(GQL-07:欄位語意的正本在 `docs/modules/demo.sample-two.md`「api 介面」節):
 * - 只有 `name` / `note` / `enabled` + 基礎欄位 —— 無分類、無狀態、無內部備註、無附件、無歷程
 * - `createdBy`:建立者;查不到使用者(示範資料的假 id、已刪除的帳號)時為 `null`
 * - `abilities`:這位操作者對這一筆能做什麼,api 依權限與歸屬算好
 * - `shareOrgs`:共用給(ADR-0014;空 = 不共用);`isShared` = 這筆是共用進來的(歸屬不在我的可見範圍)
 *
 * **不宣告 `dataScopeTarget`**(ADR-0008 的對照組):查詢只受可見範圍保底,
 * 資料範圍規則的機制完全不介入 —— 由 `demo-items-two.test.ts` 的對照測試證明。
 */
@ObjectType("DemoItemTwo")
export class DemoItemTwoModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** 停用後仍看得到,只是標示為停用(不是刪除)。 */
  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => DemoItemTwoUserModel, { nullable: true })
  createdBy!: DemoItemTwoUserModel | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => DemoItemTwoAbilitiesModel)
  abilities!: DemoItemTwoAbilitiesModel;

  @Field(() => [ShareOrgModel])
  shareOrgs!: ShareOrgModel[];

  /** 共用進來的(歸屬組織不在操作者的可見範圍內):只能看,改不了、刪不了。 */
  @Field(() => Boolean)
  isShared!: boolean;
}
