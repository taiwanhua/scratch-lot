import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  BackfillLotteryStocktakeCountSalesInput,
  BackfillLotteryStocktakeSalesInput,
  EndLotteryStocktakeSessionInput,
  LotteryStocktakeReviewInput,
  LotteryStocktakeSheetInput,
  LotteryStocktakesInput,
  SaveLotteryStocktakeSessionInput,
  StartLotteryStocktakeSessionInput,
} from "./dto/stocktake.input";
import {
  LotteryStocktakeCountBackfillModel,
  LotteryStocktakeSessionModel,
  LotteryStocktakeSessionsModel,
} from "./models/stocktake-count.model";
import {
  LotteryStocktakeBackfillPayload,
  LotteryStocktakeDetailModel,
  LotteryStocktakeReviewModel,
  LotteryStocktakeSheetModel,
  LotteryStocktakeStatusModel,
  LotteryStocktakesPayload,
} from "./models/stocktake.model";
import { StocktakeQueryService } from "./stocktake-query.service";
import { StocktakeSessions } from "./stocktake-sessions";
import { StocktakeService } from "./stocktake.service";

/**
 * 盤點的 GraphQL 端點(權限表正本 `docs/modules/project/store.md`「盤點」)。盤點頁與差異核對要
 * `store.stocktake`;[補登售出] 要 `store.sell`(service 另查 `store.stocktake`);讀取由 service 檢查 `store.view`。
 * 送出盤點確認申請走表單引擎(`createAndSubmitFormSubmission`),盤點單由掛接點建立。
 */
@RequireTenant()
@Resolver(() => LotteryStocktakeSheetModel)
export class LotteryStocktakeResolver {
  constructor(
    private readonly stocktakes: StocktakeService,
    private readonly queries: StocktakeQueryService,
    private readonly sessions: StocktakeSessions,
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

  /** [算售出 N 張](張數盤點,立即生效;另查 `store.stocktake`)。 */
  @RequirePermission("store.sell")
  @Mutation(() => LotteryStocktakeCountBackfillModel)
  backfillLotteryStocktakeCountSales(
    @Args("input") input: BackfillLotteryStocktakeCountSalesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeCountBackfillModel> {
    return this.stocktakes.backfillCount(operator, input);
  }

  /** 這家店的盤點中登記(看板、盤點頁、交班第 ① 步;讀取由 service 檢查 `store.view`)。 */
  @Query(() => LotteryStocktakeSessionsModel, {
    name: "lotteryStocktakeSessions",
  })
  lotteryStocktakeSessions(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeSessionsModel> {
    return this.sessions.list(operator, orgId);
  }

  /** 登記盤點中 / [繼續](張數店規格 8.5a)。 */
  @RequirePermission("store.stocktake")
  @Mutation(() => LotteryStocktakeSessionModel)
  startLotteryStocktakeSession(
    @Args("input") input: StartLotteryStocktakeSessionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeSessionModel> {
    return this.sessions.start(operator, input);
  }

  /** 存盤點進度、重算倒數。 */
  @RequirePermission("store.stocktake")
  @Mutation(() => LotteryStocktakeSessionModel)
  saveLotteryStocktakeSession(
    @Args("input") input: SaveLotteryStocktakeSessionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryStocktakeSessionModel> {
    return this.sessions.save(operator, input);
  }

  /** [放棄](自己的)/ 店長 [結束這個盤點](別人的;service 檢查店長 = `store.edit`)。 */
  @Mutation(() => Boolean)
  endLotteryStocktakeSession(
    @Args("input") input: EndLotteryStocktakeSessionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<boolean> {
    return this.sessions.end(operator, input);
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
