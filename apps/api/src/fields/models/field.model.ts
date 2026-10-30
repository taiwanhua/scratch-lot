import { Field, ID, Int, ObjectType } from "@nestjs/graphql";

/**
 * 欄位類別(全域,租戶不可自訂)。兩種來源:seed 宣告的系統類別,與 root 在畫面新增的類別
 * (`docs/modules/field-manager.md`「資料」)。
 */
@ObjectType("FieldCategory")
export class FieldCategoryModel {
  @Field(() => ID)
  id!: string;

  /** kebab-case 的類別 key(如 `gender`);表單定義以它引用類別,建立後不可改。 */
  @Field(() => String)
  key!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description!: string | null;

  /** `true` = seed 宣告的系統類別(不可停用);`false` = root 在畫面新增的。 */
  @Field(() => Boolean)
  isSystem!: boolean;

  /** 停用只影響表單設計器的類別清單與新選;既有欄位照常顯示。 */
  @Field(() => Boolean)
  enabled!: boolean;
}

/**
 * 自訂選項的擁有組織(來源欄「<組織名稱> 自訂」的名稱來源)。
 * 上層 / 下層組織加的選項也會出現在合併清單裡,所以組織名稱由 api 給 ——
 * 前端拿 session 的當前組織名組字串會把別的組織標成自己的。
 */
@ObjectType("FieldOwnerOrg")
export class FieldOwnerOrgModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/**
 * 欄位選項(`system.field-manager` 的主要型別)。
 * `value` 建立後不可改(舊資料以它對照),所以 `updateField` 的 input 沒有這個欄位。
 *
 * 可見範圍與可操作性的規則正本:`docs/modules/field-manager.md` 的規則表。
 * `ownerOrg` / `isOwn` / `canEdit` / `canToggleEnabled` 由 api 依操作者算好,前端只讀。
 */
@ObjectType("Field")
export class FieldModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  categoryId!: string;

  @Field(() => String)
  label!: string;

  @Field(() => String)
  value!: string;

  @Field(() => Int)
  order!: number;

  /** 停用即新填寫不再出現;既有資料不受影響(選項不可刪)。 */
  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => String, { nullable: true })
  description!: string | null;

  /**
   * 標籤色票代號(`@repo/domain/tag-palette`,顏色值由前端依代號取);`null` = 不設定顏色。
   * 改它用 `setFieldColor`,誰能改同 `canToggleEnabled`。
   */
  @Field(() => String, { nullable: true })
  color!: string | null;

  /** 加這筆的組織;`null` = 全域種子(`orgId = null`,ADR-0002)。 */
  @Field(() => FieldOwnerOrgModel, { nullable: true })
  ownerOrg!: FieldOwnerOrgModel | null;

  /** 是不是**當前組織**這一層加的;上層 / 下層組織加的為 `false`。 */
  @Field(() => Boolean)
  isOwn!: boolean;

  /** 能不能改 label / order / description:自訂選項且 `isOwn`(種子一律不可)。 */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 能不能切 `enabled`:自訂選項看 `isOwn`;種子選項是全域開關,限根組織操作者。 */
  @Field(() => Boolean)
  canToggleEnabled!: boolean;
}
