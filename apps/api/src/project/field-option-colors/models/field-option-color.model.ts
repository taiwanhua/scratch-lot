import { Field, ID, Int, ObjectType } from "@nestjs/graphql";

/**
 * 一個欄位選項的顏色(正本 `docs/modules/project/field-manager.md`「選項顏色」)。
 * `paletteKey` 是色票代號(`@repo/domain/project/tag-palette`);顏色值由前端依代號取。
 */
@ObjectType("FieldOptionColor")
export class FieldOptionColorModel {
  /** 選項 id(`Field.id`);同一類別合併清單裡可能有兩筆同 `value`(旁支 / 下層),以 id 分辨。 */
  @Field(() => ID)
  fieldId!: string;

  /** 選項的值(`Field.value`)。 */
  @Field(() => String)
  value!: string;

  /** 色票代號;`null` = 不設定顏色(只出現在 `setFieldOptionColor` 的回傳,清單只列有顏色的)。 */
  @Field(() => String, { nullable: true })
  paletteKey!: string | null;
}

/** 一個類別下有顏色的選項(GQL-03 列表形狀;不分頁,`totalCount` 即 `items` 長度)。 */
@ObjectType()
export class FieldOptionColorsPayload {
  @Field(() => [FieldOptionColorModel])
  items!: FieldOptionColorModel[];

  @Field(() => Int)
  totalCount!: number;
}

/** `setFieldOptionColor` 的回傳(GQL-02)。 */
@ObjectType()
export class FieldOptionColorPayload {
  @Field(() => FieldOptionColorModel)
  color!: FieldOptionColorModel;
}
