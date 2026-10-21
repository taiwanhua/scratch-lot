import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { CloseLotteryPeriodInput } from "./dto/period-close.input";
import {
  LotteryPeriodCloseCheckModel,
  LotteryPeriodCloseModel,
  LotteryPeriodClosesModel,
} from "./models/period-close.model";
import { PeriodCloseService } from "./period-close.service";

/**
 * 關帳的 GraphQL 端點(權限表正本 `docs/modules/project/accounts.md`):關帳分頁、檢查清單、快照與 [關帳]
 * 一律守 `accounts.close-period`(沒有這條權限看不到分頁與 [關帳])。沒有修改 / 刪除(不能重新開帳)。
 */
@Resolver(() => LotteryPeriodCloseModel)
export class LotteryPeriodCloseResolver {
  constructor(private readonly periods: PeriodCloseService) {}

  @RequirePermission("accounts.close-period")
  @Query(() => LotteryPeriodClosesModel, { name: "lotteryPeriodCloses" })
  lotteryPeriodCloses(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPeriodClosesModel> {
    return this.periods.list(operator);
  }

  @RequirePermission("accounts.close-period")
  @Query(() => LotteryPeriodCloseCheckModel, {
    name: "lotteryPeriodCloseCheck",
  })
  lotteryPeriodCloseCheck(
    @Args("month") month: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPeriodCloseCheckModel> {
    return this.periods.check(operator, month);
  }

  @RequirePermission("accounts.close-period")
  @Query(() => LotteryPeriodCloseModel, { name: "lotteryPeriodClose" })
  lotteryPeriodClose(
    @Args("month") month: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPeriodCloseModel> {
    return this.periods.get(operator, month);
  }

  @RequirePermission("accounts.close-period")
  @Mutation(() => LotteryPeriodCloseModel, { name: "closeLotteryPeriod" })
  closeLotteryPeriod(
    @Args("input") input: CloseLotteryPeriodInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryPeriodCloseModel> {
    return this.periods.close(operator, input);
  }
}
