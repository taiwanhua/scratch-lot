import { Args, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import {
  ScheduleFieldOptionModel,
  ScheduleFieldOptionsPayload,
} from "./schedule-field-option.model";
import { ScheduleFieldOptionsService } from "./schedule-field-options.service";

/**
 * 排班畫面的下拉選項。與表單的 `formFieldOptions` 同一種守門:
 * 顯示選項的頁面都要用,只要登入、不需要欄位管理的權限(選項本身不是機密)。
 */
@Resolver(() => ScheduleFieldOptionModel)
export class ScheduleFieldOptionsResolver {
  constructor(private readonly service: ScheduleFieldOptionsService) {}

  @Query(() => ScheduleFieldOptionsPayload, { name: "scheduleFieldOptions" })
  async scheduleFieldOptions(
    @Args("categoryKey", { type: () => String }) categoryKey: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleFieldOptionsPayload> {
    const items = await this.service.options(operator, categoryKey);
    return { items, totalCount: items.length };
  }
}
