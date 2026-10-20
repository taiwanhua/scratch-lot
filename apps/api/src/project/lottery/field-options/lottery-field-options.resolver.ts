import { Args, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import {
  LotteryFieldOptionModel,
  LotteryFieldOptionsPayload,
} from "./lottery-field-option.model";
import { LotteryFieldOptionsService } from "./lottery-field-options.service";

/**
 * 刮刮樂畫面的下拉選項。與 `scheduleFieldOptions`、`formFieldOptions` 同一種守門:
 * 顯示選項的頁面都要用,只要登入、不需要欄位管理的權限(選項本身不是機密)。
 */
@Resolver(() => LotteryFieldOptionModel)
export class LotteryFieldOptionsResolver {
  constructor(private readonly service: LotteryFieldOptionsService) {}

  @Query(() => LotteryFieldOptionsPayload, { name: "lotteryFieldOptions" })
  async lotteryFieldOptions(
    @Args("categoryKey", { type: () => String }) categoryKey: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryFieldOptionsPayload> {
    const items = await this.service.options(operator, categoryKey);
    return { items, totalCount: items.length };
  }
}
