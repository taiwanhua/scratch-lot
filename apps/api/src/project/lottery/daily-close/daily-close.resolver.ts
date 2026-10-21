import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { BankDepositService } from "./bank-deposit.service";
import { DailyCloseQueryService } from "./daily-close-query.service";
import { DepositLotteryVaultToBankInput } from "./dto/daily-close.input";
import {
  LotteryBankDepositFormModel,
  LotteryBankDepositPayloadModel,
  LotteryDailyCloseStatusModel,
  LotteryDailyCloseWizardModel,
} from "./models/daily-close.model";

/**
 * 日結與存銀行的 GraphQL 端點(權限表正本 `docs/modules/project/store.md`「日結與存銀行」)。
 * 送出日結走表單引擎(`createAndSubmitFormSubmission`,結帳確認申請類型 = 日結),結帳單由掛接點建立。
 */
@Resolver(() => LotteryDailyCloseWizardModel)
export class LotteryDailyCloseResolver {
  constructor(
    private readonly queries: DailyCloseQueryService,
    private readonly deposits: BankDepositService,
  ) {}

  @RequirePermission("store.view")
  @Query(() => LotteryDailyCloseStatusModel, {
    name: "lotteryDailyCloseStatus",
  })
  lotteryDailyCloseStatus(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDailyCloseStatusModel> {
    return this.queries.status(operator, orgId);
  }

  @RequirePermission("store.checkout")
  @Query(() => LotteryDailyCloseWizardModel, {
    name: "lotteryDailyCloseWizard",
  })
  lotteryDailyCloseWizard(
    @Args("orgId", { type: () => ID }) orgId: string,
    @Args("submissionId", { type: () => ID, nullable: true })
    submissionId: string | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryDailyCloseWizardModel> {
    return this.queries.wizard(operator, orgId, submissionId);
  }

  @RequirePermission("store.bank-deposit")
  @Query(() => LotteryBankDepositFormModel, { name: "lotteryBankDepositForm" })
  lotteryBankDepositForm(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankDepositFormModel> {
    return this.deposits.form(operator, orgId);
  }

  @RequirePermission("store.bank-deposit")
  @Mutation(() => LotteryBankDepositPayloadModel, {
    name: "depositLotteryVaultToBank",
  })
  depositLotteryVaultToBank(
    @Args("input") input: DepositLotteryVaultToBankInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankDepositPayloadModel> {
    return this.deposits.deposit(operator, input);
  }
}
