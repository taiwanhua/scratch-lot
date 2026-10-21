import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import {
  BackfillLotteryStocktakeSalesInput,
  LotteryStocktakeReviewInput,
  LotteryStocktakeSheetInput,
  LotteryStocktakesInput,
} from "./dto/stocktake.input";
import {
  LotteryStocktakeBackfillPayload,
  LotteryStocktakeDetailModel,
  LotteryStocktakeReviewModel,
  LotteryStocktakeSheetModel,
  LotteryStocktakeStatusModel,
  LotteryStocktakesPayload,
} from "./models/stocktake.model";
import { StocktakeQueryService } from "./stocktake-query.service";
import { StocktakeService } from "./stocktake.service";

/**
 * 盤點的 GraphQL 端點(權限表正本 `docs/modules/project/store.md`「盤點」)。盤點頁與差異核對要
 * `store.stocktake`;[補登售出] 要 `store.sell`(service 另查 `store.stocktake`);讀取由 service 檢查 `store.view`。
 * 送出盤點確認申請走表單引擎(`createAndSubmitFormSubmission`),盤點單由掛接點建立。
 */
@Resolver(() => LotteryStocktakeSheetModel)
export class LotteryStocktakeResolver {
  constructor(
    private readonly stocktakes: StocktakeService,
    private readonly queries: StocktakeQueryService,
  ) {}

  @RequirePermission("store.stocktake")
  @Query(() => LotteryStocktakeSheetModel, { name: "lotteryStocktakeSheet" })
  lotteryStocktakeSheet(
    @Args("input") input: LotteryStocktakeSheetInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeSheetModel> {
    return this.queries.sheet(operator, input.orgId, input.cashPointId ?? null);
  }

  @RequirePermission("store.stocktake")
  @Query(() => LotteryStocktakeReviewModel, { name: "lotteryStocktakeReview" })
  lotteryStocktakeReview(
    @Args("input") input: LotteryStocktakeReviewInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeReviewModel> {
    return this.stocktakes.review(operator, input);
  }

  @RequirePermission("store.sell")
  @Mutation(() => LotteryStocktakeBackfillPayload)
  async backfillLotteryStocktakeSales(
    @Args("input") input: BackfillLotteryStocktakeSalesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeBackfillPayload> {
    return { items: await this.stocktakes.backfill(operator, input) };
  }

  @Query(() => LotteryStocktakeStatusModel, { name: "lotteryStocktakeStatus" })
  lotteryStocktakeStatus(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeStatusModel> {
    return this.queries.status(operator, orgId);
  }

  @Query(() => LotteryStocktakesPayload, { name: "lotteryStocktakes" })
  lotteryStocktakes(
    @Args("input") input: LotteryStocktakesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakesPayload> {
    return this.queries.list(operator, input);
  }

  @Query(() => LotteryStocktakeDetailModel, { name: "lotteryStocktake" })
  lotteryStocktake(
    @Args("submissionId", { type: () => ID }) submissionId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeDetailModel> {
    return this.queries.detail(operator, submissionId);
  }
}
