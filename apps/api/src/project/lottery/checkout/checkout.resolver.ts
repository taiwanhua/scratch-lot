import { Args, ID, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { CheckoutQueryService } from "./checkout-query.service";
import { LotteryCheckoutsInput } from "./dto/checkout.input";
import {
  LotteryCheckoutDetailModel,
  LotteryCheckoutWizardModel,
  LotteryCheckoutsPayload,
} from "./models/checkout.model";

/**
 * 交班結帳的 GraphQL 端點(權限表正本 `docs/modules/project/store.md`「交班結帳」)。精靈要 `store.checkout`
 * (service 另判斷負責人或店長);列表與檢視頁由 service 檢查 `store.view`。
 * 送出結帳確認申請走表單引擎(`createAndSubmitFormSubmission`),結帳單由掛接點建立。
 */
@Resolver(() => LotteryCheckoutWizardModel)
export class LotteryCheckoutResolver {
  constructor(private readonly queries: CheckoutQueryService) {}

  @RequirePermission("store.checkout")
  @Query(() => LotteryCheckoutWizardModel, { name: "lotteryCheckoutWizard" })
  lotteryCheckoutWizard(
    @Args("shiftId", { type: () => ID }) shiftId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCheckoutWizardModel> {
    return this.queries.wizard(operator, shiftId);
  }

  @RequirePermission("store.view")
  @Query(() => LotteryCheckoutsPayload, { name: "lotteryCheckouts" })
  lotteryCheckouts(
    @Args("input") input: LotteryCheckoutsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCheckoutsPayload> {
    return this.queries.list(operator, input);
  }

  @RequirePermission("store.view")
  @Query(() => LotteryCheckoutDetailModel, { name: "lotteryCheckout" })
  lotteryCheckout(
    @Args("submissionId", { type: () => ID }) submissionId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryCheckoutDetailModel> {
    return this.queries.detail(operator, submissionId);
  }
}
