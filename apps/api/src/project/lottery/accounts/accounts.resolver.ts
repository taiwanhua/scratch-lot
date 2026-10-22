import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import { BankAccountsService } from "./bank-accounts.service";
import { BankTransactionsService } from "./bank-transactions.service";
import {
  CreateLotteryBankAccountInput,
  LotteryBankAccountsInput,
  LotteryBankTransactionsInput,
  RecordLotteryBankTransactionInput,
  ReverseLotteryBankTransactionInput,
  UpdateLotteryBankAccountInput,
} from "./dto/lottery-bank-account.input";
import {
  DeleteLotteryBankAccountPayload,
  LotteryBankAccountModel,
  LotteryBankAccountPayload,
  LotteryBankAccountsPayload,
  LotteryBankTransactionPayload,
  LotteryBankTransactionsPayload,
} from "./models/lottery-bank-account.model";

/**
 * 銀行帳戶與交易的 GraphQL 端點(權限表正本 `docs/modules/project/accounts.md`)。
 * 讀取由 service 檢查 `accounts.view-bank-accounts`;寫入守對應的頁內權限。交易只新增(沒有修改 / 刪除端點)。
 */
@RequireTenant()
@Resolver(() => LotteryBankAccountModel)
export class LotteryBankAccountsResolver {
  constructor(
    private readonly accounts: BankAccountsService,
    private readonly transactions: BankTransactionsService,
  ) {}

  @Query(() => LotteryBankAccountsPayload, { name: "lotteryBankAccounts" })
  lotteryBankAccounts(
    @Args("input") input: LotteryBankAccountsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankAccountsPayload> {
    return this.accounts.list(operator, input);
  }

  @Query(() => LotteryBankAccountPayload, { name: "lotteryBankAccount" })
  async lotteryBankAccount(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankAccountPayload> {
    return { item: await this.accounts.get(operator, id) };
  }

  @Query(() => LotteryBankTransactionsPayload, {
    name: "lotteryBankTransactions",
  })
  lotteryBankTransactions(
    @Args("input") input: LotteryBankTransactionsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankTransactionsPayload> {
    return this.transactions.list(operator, input);
  }

  @RequirePermission("accounts.create-bank-account")
  @Mutation(() => LotteryBankAccountPayload)
  async createLotteryBankAccount(
    @Args("input") input: CreateLotteryBankAccountInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankAccountPayload> {
    return { item: await this.accounts.create(operator, input) };
  }

  @RequirePermission("accounts.edit-bank-account")
  @Mutation(() => LotteryBankAccountPayload)
  async updateLotteryBankAccount(
    @Args("input") input: UpdateLotteryBankAccountInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankAccountPayload> {
    return { item: await this.accounts.update(operator, input) };
  }

  @RequirePermission("accounts.edit-bank-account")
  @Mutation(() => DeleteLotteryBankAccountPayload)
  async deleteLotteryBankAccount(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteLotteryBankAccountPayload> {
    return { id: await this.accounts.delete(operator, id) };
  }

  @RequirePermission("accounts.record-bank-transaction")
  @Mutation(() => LotteryBankTransactionPayload)
  async recordLotteryBankTransaction(
    @Args("input") input: RecordLotteryBankTransactionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankTransactionPayload> {
    return { item: await this.transactions.record(operator, input) };
  }

  @RequirePermission("accounts.reverse-bank-transaction")
  @Mutation(() => LotteryBankTransactionPayload)
  async reverseLotteryBankTransaction(
    @Args("input") input: ReverseLotteryBankTransactionInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryBankTransactionPayload> {
    return { item: await this.transactions.reverse(operator, input) };
  }
}
