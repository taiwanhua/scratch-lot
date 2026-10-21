import { Args, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { FieldOptionsService } from "../../../fields/field-options.service";
import {
  LotteryFieldOptionModel,
  LotteryFieldOptionsPayload,
} from "./lottery-field-option.model";
import { LOTTERY_FIELD_CATEGORIES } from "./lottery-field-options";

/**
 * 刮刮樂畫面的下拉選項(底座 `FieldOptionsService.optionsOf`,只收刮刮樂的類別)。與 `scheduleFieldOptions`、`formFieldOptions` 同一種守門:
 * 顯示選項的頁面都要用,只要登入、不需要欄位管理的權限(選項本身不是機密)。
 */
@Resolver(() => LotteryFieldOptionModel)
export class LotteryFieldOptionsResolver {
  constructor(private readonly fieldOptions: FieldOptionsService) {}

  @Query(() => LotteryFieldOptionsPayload, { name: "lotteryFieldOptions" })
  async lotteryFieldOptions(
    @Args("categoryKey", { type: () => String }) categoryKey: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryFieldOptionsPayload> {
    const items = await this.fieldOptions.optionsOf(
      operator,
      categoryKey,
      LOTTERY_FIELD_CATEGORIES,
    );
    return { items, totalCount: items.length };
  }
}
