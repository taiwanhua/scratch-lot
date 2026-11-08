import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  FinishLotteryRescanPlaceInput,
  LotteryRescanInput,
  ScanLotteryRescanTicketInput,
  StartLotteryRescanInput,
} from "./dto/rescan.input";
import {
  LotteryRescanModel,
  LotteryRescanScanPayload,
} from "./models/rescan.model";
import { RescanService } from "./rescan.service";

/**
 * 全店重刷的 GraphQL 端點(張數店規格 8.4、14.2;權限表正本 `docs/modules/project/store.md`「全店重刷」):
 * 開始、刷、刷完要 `store.stocktake`(重刷是盤點的一種,不新增權限,規格 12);重刷頁要 `store.view`(service 檢查);
 * [取消重刷] = 開始重刷的人或店長(service 檢查)。
 */
@RequireTenant()
@Resolver(() => LotteryRescanModel)
export class LotteryRescanResolver {
  constructor(private readonly rescans: RescanService) {}

  @Query(() => LotteryRescanModel, { name: "lotteryRescan" })
  lotteryRescan(
    @Args("input") input: LotteryRescanInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRescanModel> {
    return this.rescans.view(operator, input);
  }

  @RequirePermission("store.stocktake")
  @Mutation(() => LotteryRescanModel)
  startLotteryRescan(
    @Args("input") input: StartLotteryRescanInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRescanModel> {
    return this.rescans.start(operator, input);
  }

  @RequirePermission("store.stocktake")
  @Mutation(() => LotteryRescanScanPayload)
  scanLotteryRescanTicket(
    @Args("input") input: ScanLotteryRescanTicketInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRescanScanPayload> {
    return this.rescans.scan(operator, input);
  }

  @RequirePermission("store.stocktake")
  @Mutation(() => LotteryRescanModel)
  finishLotteryRescanPlace(
    @Args("input") input: FinishLotteryRescanPlaceInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRescanModel> {
    return this.rescans.finishPlace(operator, input);
  }

  /** [取消重刷]:開始重刷的人或店長(service 檢查)。 */
  @Mutation(() => LotteryRescanModel)
  cancelLotteryRescan(
    @Args("input") input: LotteryRescanInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryRescanModel> {
    return this.rescans.cancel(operator, input);
  }
}
