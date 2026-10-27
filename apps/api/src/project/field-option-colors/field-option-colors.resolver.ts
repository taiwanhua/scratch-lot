import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../auth/decorators";
import type { OperatorContext } from "../../database/operator-context";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { SetFieldOptionColorInput } from "./dto/set-field-option-color.input";
import { FieldOptionColorsService } from "./field-option-colors.service";
import {
  FieldOptionColorModel,
  FieldOptionColorPayload,
  FieldOptionColorsPayload,
} from "./models/field-option-color.model";

/**
 * 欄位選項顏色的端點(S2 專案客製)。讀取與表單的 `formFieldOptions` 同一種守門:
 * 顯示選項的頁面都要用,只要登入、不需要欄位管理的權限;設定綁欄位管理的 `edit`(顏色欄在欄位管理頁)。
 */
@Resolver(() => FieldOptionColorModel)
export class FieldOptionColorsResolver {
  constructor(private readonly service: FieldOptionColorsService) {}

  @Query(() => FieldOptionColorsPayload, { name: "fieldOptionColors" })
  fieldOptionColors(
    @Args("categoryKey", { type: () => String }) categoryKey: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FieldOptionColorsPayload> {
    return this.service.list(operator, categoryKey);
  }

  @RequirePermission("system.field-manager.edit")
  @Mutation(() => FieldOptionColorPayload)
  async setFieldOptionColor(
    @Args("input") input: SetFieldOptionColorInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FieldOptionColorPayload> {
    return { color: await this.service.set(operator, input) };
  }
}
