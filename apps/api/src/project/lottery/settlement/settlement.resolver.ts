import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  LotterySettlementCandidatesInput,
  RecordLotterySettlementInput,
  ReverseLotterySettlementInput,
} from "./dto/lottery-settlement.input";
import {
  LotteryOutstandingSettlementsPayload,
  LotterySettlementAccountsPayload,
  LotterySettlementModel,
  LotterySettlementPayload,
  RecordLotterySettlementPayload,
} from "./models/lottery-settlement.model";
import { SettlementService } from "./settlement.service";

/**
 * 收付機制的端點(規格第 9 章)。按鈕權限沿用單據登記的(`settle` / `pay` / `receive`),由 service 依
 * 那一邊檢查;待結清款項要 `accounts.view-outstanding`,單據候選要 `accounts.record-bank-transaction`。
 */
@RequireTenant()
@Resolver(() => LotterySettlementModel)
export class LotterySettlementResolver {
  constructor(private readonly settlement: SettlementService) {}

  @Query(() => LotterySettlementPayload, { name: "lotterySettlement" })
  async lotterySettlement(
    @Args("moduleKey") moduleKey: string,
    @Args("refId", { type: () => ID }) refId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotterySettlementPayload> {
    return {
      item: await this.settlement.settlement(operator, moduleKey, refId),
    };
  }

  @Query(() => LotteryOutstandingSettlementsPayload, {
    name: "lotteryOutstandingSettlements",
  })
  async lotteryOutstandingSettlements(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryOutstandingSettlementsPayload> {
    const items = await this.settlement.outstanding(operator);
    return { items, totalCount: items.length };
  }

  @Query(() => LotteryOutstandingSettlementsPayload, {
    name: "lotterySettlementCandidates",
  })
  async lotterySettlementCandidates(
    @Args("input") input: LotterySettlementCandidatesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryOutstandingSettlementsPayload> {
    const items = await this.settlement.candidates(operator, input);
    return { items, totalCount: items.length };
  }

  @Query(() => LotterySettlementAccountsPayload, {
    name: "lotterySettlementAccounts",
  })
  async lotterySettlementAccounts(
    @Args("moduleKey") moduleKey: string,
    @Args("refId", { type: () => ID }) refId: string,
    @Args("side") side: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotterySettlementAccountsPayload> {
    const items = await this.settlement.accountOptions(
      operator,
      moduleKey,
      refId,
      side,
    );
    return {
      items: items.map((item) => ({ id: item.id, name: item.label })),
      totalCount: items.length,
    };
  }

  @Mutation(() => RecordLotterySettlementPayload)
  recordLotterySettlement(
    @Args("input") input: RecordLotterySettlementInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RecordLotterySettlementPayload> {
    return this.settlement.record(operator, input);
  }

  @Mutation(() => RecordLotterySettlementPayload)
  reverseLotterySettlement(
    @Args("input") input: ReverseLotterySettlementInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RecordLotterySettlementPayload> {
    return this.settlement.reverse(operator, input);
  }
}
