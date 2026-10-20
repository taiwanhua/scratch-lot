import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryBankAccount } from "./lottery-bank-account.schema";
import { LotteryBankTransaction } from "./lottery-bank-transaction.schema";
import { LotteryCashMovement } from "./lottery-cash-movement.schema";

export type LotteryBankAccountDocument = HydratedDocument<LotteryBankAccount>;
export type LotteryBankTransactionDocument =
  HydratedDocument<LotteryBankTransaction>;
export type LotteryCashMovementDocument = HydratedDocument<LotteryCashMovement>;

/** 只新增的帳本被要求修改 / 刪除(程式錯誤:記錯一律沖正)。 */
export class AppendOnlyLedgerError extends Error {
  constructor(collection: string) {
    super(`${collection} 只新增:記錯請沖正,不能修改或刪除`);
    this.name = "AppendOnlyLedgerError";
  }
}

/** lottery_bank_accounts(銀行帳戶,專案規格 10.1)。 */
@Injectable()
export class LotteryBankAccountsRepository extends BaseRepository<
  LotteryBankAccount,
  LotteryBankAccountDocument
> {
  constructor(
    @InjectModel(LotteryBankAccount.name)
    model: RepositoryModel<LotteryBankAccount, LotteryBankAccountDocument>,
  ) {
    super(model);
  }
}

/**
 * lottery_bank_transactions(銀行交易,只新增)。修改 / 刪除的方法一律拋錯:
 * 第 17 章「應有現金只由事件加總,不另存可被改寫的數字」—— 帳本本身也不改寫。
 */
@Injectable()
export class LotteryBankTransactionsRepository extends BaseRepository<
  LotteryBankTransaction,
  LotteryBankTransactionDocument
> {
  constructor(
    @InjectModel(LotteryBankTransaction.name)
    model: RepositoryModel<
      LotteryBankTransaction,
      LotteryBankTransactionDocument
    >,
  ) {
    super(model);
  }

  override updateById(): never {
    throw new AppendOnlyLedgerError(this.collectionName);
  }

  override findOneAndUpdate(): never {
    throw new AppendOnlyLedgerError(this.collectionName);
  }

  override updateMany(): never {
    throw new AppendOnlyLedgerError(this.collectionName);
  }

  override softDeleteById(): never {
    throw new AppendOnlyLedgerError(this.collectionName);
  }
}

/** lottery_cash_movements(現金流水,只新增;寫入唯一入口 `CashLedgerService`)。 */
@Injectable()
export class LotteryCashMovementsRepository extends BaseRepository<
  LotteryCashMovement,
  LotteryCashMovementDocument
> {
  constructor(
    @InjectModel(LotteryCashMovement.name)
    model: RepositoryModel<LotteryCashMovement, LotteryCashMovementDocument>,
  ) {
    super(model);
  }

  override updateById(): never {
    throw new AppendOnlyLedgerError(this.collectionName);
  }

  override findOneAndUpdate(): never {
    throw new AppendOnlyLedgerError(this.collectionName);
  }

  override updateMany(): never {
    throw new AppendOnlyLedgerError(this.collectionName);
  }

  override softDeleteById(): never {
    throw new AppendOnlyLedgerError(this.collectionName);
  }
}
