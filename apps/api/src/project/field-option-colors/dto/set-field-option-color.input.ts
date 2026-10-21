import { Field, ID, InputType } from "@nestjs/graphql";

/**
 * 設定一個選項的顏色(`system.field-manager.edit`)。誰能設 = 誰能停用 / 啟用那一筆:
 * 自訂選項限加它的那一層;全域種子限根組織(顏色對全平台生效)。
 */
@InputType()
export class SetFieldOptionColorInput {
  @Field(() => ID)
  fieldId!: string;

  /** 色票代號;缺席 / `null` = 清掉顏色。不在色票清單 → `VALIDATION_FAILED`(不能輸入色碼)。 */
  @Field(() => String, { nullable: true })
  paletteKey?: string | null;
}
