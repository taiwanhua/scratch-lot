import { Field, Int, ObjectType } from "@nestjs/graphql";

import { FieldCategoryModel, FieldModel } from "./field.model";

/**
 * 三個寫入 mutation 的共用回傳(GQL-02:mutation 一律回 payload type,
 * 留下之後加欄位的空間;
 * 不直接回 `Field!`)。
 */
@ObjectType()
export class FieldPayload {
  @Field(() => FieldModel)
  field!: FieldModel;
}

/** 類別的三個寫入 mutation 的共用回傳(GQL-02)。 */
@ObjectType()
export class FieldCategoryPayload {
  @Field(() => FieldCategoryModel)
  category!: FieldCategoryModel;
}

/** 類別清單(GQL-03 的列表形狀;字典型資料不分頁,`totalCount` 即 `items` 長度)。 */
@ObjectType()
export class FieldCategoriesPayload {
  @Field(() => [FieldCategoryModel])
  items!: FieldCategoryModel[];

  @Field(() => Int)
  totalCount!: number;
}

/** 一個類別下的合併清單(GQL-03 的列表形狀;不分頁,`totalCount` 即 `items` 長度)。 */
@ObjectType()
export class FieldsPayload {
  @Field(() => [FieldModel])
  items!: FieldModel[];

  @Field(() => Int)
  totalCount!: number;
}
