import type { DatabaseRegistration } from "../../../database/registration";
import {
  LotteryBankAccountsRepository,
  LotteryBankTransactionsRepository,
  LotteryCashMovementsRepository,
} from "./lottery-accounts.repositories";
import {
  LOTTERY_BANK_ACCOUNTS_COLLECTION,
  LotteryBankAccount,
  LotteryBankAccountSchema,
} from "./lottery-bank-account.schema";
import {
  LOTTERY_BANK_TRANSACTIONS_COLLECTION,
  LotteryBankTransaction,
  LotteryBankTransactionSchema,
} from "./lottery-bank-transaction.schema";
import {
  LOTTERY_CASH_MOVEMENTS_COLLECTION,
  LotteryCashMovement,
  LotteryCashMovementSchema,
} from "./lottery-cash-movement.schema";

/** 帳戶管理的資料登記:銀行帳戶、銀行交易、現金流水三張模組資料表。 */
export const LOTTERY_ACCOUNTS_REGISTRATION: DatabaseRegistration = {
  key: "lottery-accounts",
  models: [
    {
      name: LotteryBankAccount.name,
      collection: LOTTERY_BANK_ACCOUNTS_COLLECTION,
      schema: LotteryBankAccountSchema,
    },
    {
      name: LotteryBankTransaction.name,
      collection: LOTTERY_BANK_TRANSACTIONS_COLLECTION,
      schema: LotteryBankTransactionSchema,
    },
    {
      name: LotteryCashMovement.name,
      collection: LOTTERY_CASH_MOVEMENTS_COLLECTION,
      schema: LotteryCashMovementSchema,
    },
  ],
  repositories: [
    {
      modelName: LotteryBankAccount.name,
      provider: LotteryBankAccountsRepository,
    },
    {
      modelName: LotteryBankTransaction.name,
      provider: LotteryBankTransactionsRepository,
    },
    {
      modelName: LotteryCashMovement.name,
      provider: LotteryCashMovementsRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-bank-accounts",
      modelName: LotteryBankAccount.name,
      repository: LotteryBankAccountsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-bank-transactions",
      modelName: LotteryBankTransaction.name,
      repository: LotteryBankTransactionsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-cash-movements",
      modelName: LotteryCashMovement.name,
      repository: LotteryCashMovementsRepository,
      ownerField: "orgId",
    },
  ],
};
