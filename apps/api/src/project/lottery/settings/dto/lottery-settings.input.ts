import { Field, ID, InputType } from "@nestjs/graphql";

/** 某個組織的刮刮樂設定頁(`orgId` 缺席或 null = 當前組織)。 */
@InputType()
export class LotterySettingsInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;
}

/** [自訂] 一條設定:本層寫一列(已自訂就改那一列)。`option` 要是那條設定的選項之一。 */
@InputType()
export class CustomizeLotterySettingInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  key!: string;

  @Field(() => String)
  option!: string;
}

/** [還原]:刪掉本層的自訂,回到沿用上層。 */
@InputType()
export class RestoreLotterySettingInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  key!: string;
}

/**
 * 改盤點制度前的檢查(編輯對話框打開與選項改變時呼叫):`option` 給值 = 本層要自訂成這個值;
 * 缺席或 null = [還原] 成沿用上層。
 */
@InputType()
export class LotteryCountModeChangeCheckInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String, { nullable: true })
  option?: string | null;
}

/** [取消轉換]:只有轉換中的分店。 */
@InputType()
export class CancelLotteryCountModeConversionInput {
  @Field(() => ID)
  orgId!: string;
}

/** [變更紀錄]:某家分店的盤點制度歷程。 */
@InputType()
export class LotteryStoreCountModeHistoryInput {
  @Field(() => ID)
  orgId!: string;
}
