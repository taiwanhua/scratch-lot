import { Injectable } from "@nestjs/common";

import {
  DAILY_CLOSE_REASONS,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import { LotteryBankAccountsRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import { ACCOUNTS_AUDIT } from "../accounts/accounts-audit";
import { ACCOUNTS_REASONS } from "../accounts/accounts-error";
import { BankTransactionsService } from "../accounts/bank-transactions.service";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { validationError } from "../checkout/checkout-error";
import { SettlementService } from "../settlement/settlement.service";
import { parseId } from "../store/shift-views";
import { StoreAccess } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { forbiddenError } from "../store/store-error";
import { StoreSalesSupport } from "../store/store-sales-support";
import { StoreVaultGuard } from "../store/store-vault-guard";
import type { DepositLotteryVaultToBankInput } from "./dto/daily-close.input";
import type {
  LotteryBankDepositFormModel,
  LotteryBankDepositPayloadModel,
} from "./models/daily-close.model";

/** 備註上限(同銀行交易的備註)。 */
const NOTE_MAX = 200;

/**
 * 存銀行(專案規格 6.11;正本 `docs/modules/project/store.md`「日結與存銀行」):頂部 [存銀行],
 * `store.bank-deposit`。不用審核、做完就生效(同投庫、出庫):同一個交易寫現金流水「存銀行」(小金庫 → 銀行)
 * + 銀行「存入」(歸屬分店 = 這家店),兩筆以 `bankTransactionId` 連起來。
 *
 * - 金額不能超過小金庫目前的應有(`StoreVaultGuard`,與出庫同一個守門文件序列化;`AMOUNT_EXCEEDS_VAULT`)
 * - 帳戶:使用中、使用組織包含這家店;這家店沒有任何可用的帳戶 → `BANK_DEPOSIT_NO_ACCOUNT`(Figma ST-26b)
 * - 記錯:到帳戶管理沖正那筆「存入」,連結的「存銀行」流水自動反向(`BankTransactionsService.reverseRecord`)
 */
@Injectable()
export class BankDepositService {
  constructor(
    private readonly accounts: LotteryBankAccountsRepository,
    private readonly orgs: OrgsRepository,
    private readonly bankTransactions: BankTransactionsService,
    private readonly cashLedger: CashLedgerService,
    private readonly settlement: SettlementService,
    private readonly vault: StoreVaultGuard,
    private readonly support: StoreSalesSupport,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  async form(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryBankDepositFormModel> {
    await this.assertPermission(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const [org, vault, accounts] = await Promise.all([
      this.orgs.findById(operator, store.orgId),
      this.cashLedger.vaultExpected(operator, store.tenantId, store.orgId),
      this.settlement.usableAccountsOf(operator, store.tenantId, store.orgId),
    ]);
    return {
      org: { id: String(store.orgId), name: org?.name ?? "" },
      vaultExpected: vault.amount,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.label,
      })),
    };
  }

  async deposit(
    operator: OperatorContext,
    input: DepositLotteryVaultToBankInput,
  ): Promise<LotteryBankDepositPayloadModel> {
    await this.assertPermission(operator);
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw validationError("amount must be a positive integer", ["amount"]);
    }
    const note = input.note?.trim() ?? "";
    if (note.length > NOTE_MAX) {
      throw validationError("note is too long", ["note"]);
    }
    const store = await this.support.mustStore(operator, input.orgId);
    const accountId = parseId(input.accountId);
    const account =
      accountId !== null &&
      (await this.settlement.isAccountUsable(
        store.tenantId,
        accountId,
        store.orgId,
        operator,
      ))
        ? await this.accounts.findById(operator, accountId)
        : null;
    if (account === null) {
      const choices = await this.settlement.usableAccountsOf(
        operator,
        store.tenantId,
        store.orgId,
      );
      throw validationError(
        "bank account is not usable by this store",
        ["accountId"],
        choices.length === 0
          ? DAILY_CLOSE_REASONS.noBankAccount
          : ACCOUNTS_REASONS.accountNotUsable,
      );
    }
    await this.vault.prepare(operator, store.orgId);
    const writer = { ...operator, currentOrgId: store.orgId };
    const written = await this.transactions.withTransaction(async (session) => {
      // 不能超過小金庫應有(同一家店同時從小金庫拿錢在守門文件上序列化)
      await this.vault.assertCovers(
        session,
        operator,
        store.tenantId,
        store.orgId,
        input.amount,
        "amount",
      );
      const now = this.clock.now();
      const transaction = await this.bankTransactions.write(
        writer,
        {
          account,
          type: "deposit",
          direction: "in",
          amount: input.amount,
          occurredAt: now,
          branchOrgId: store.orgId,
          summary: "存銀行",
          note: note === "" ? null : note,
        },
        { session },
      );
      const movement = await this.cashLedger.recordCashMovement(session, {
        operator: writer,
        orgId: store.orgId,
        type: "bank_deposit",
        from: "vault",
        to: "bank",
        amount: input.amount,
        occurredAt: now,
        note: note === "" ? null : note,
        bankTransactionId: transaction._id,
      });
      await this.audit.record(operator, {
        action: ACCOUNTS_AUDIT.transactionCreate,
        targetType: ACCOUNTS_AUDIT.transactionTarget,
        targetId: transaction._id,
        after: {
          accountId: String(account._id),
          type: "deposit",
          amount: input.amount,
          branchOrgId: String(store.orgId),
          cashMovementId: String(movement._id),
        },
      });
      await this.support.publish(store);
      return { transaction, movement };
    });
    const vault = await this.cashLedger.vaultExpected(
      operator,
      store.tenantId,
      store.orgId,
    );
    return {
      vaultExpected: vault.amount,
      movementId: String(written.movement._id),
      transactionId: String(written.transaction._id),
    };
  }

  private async assertPermission(operator: OperatorContext): Promise<void> {
    const grant = await this.access.assertView(operator);
    if (!grant.has(STORE_PERMISSIONS.bankDeposit)) {
      throw forbiddenError(
        `Missing permission ${STORE_PERMISSIONS.bankDeposit}`,
      );
    }
  }
}
