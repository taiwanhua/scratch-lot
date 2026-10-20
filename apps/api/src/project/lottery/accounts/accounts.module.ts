import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { SidebarBadgesModule } from "../../../sidebar-badges/sidebar-badges.module";
import { CashLedgerViewService } from "../cash/cash-ledger-view.service";
import { LotteryCashLedgerResolver } from "../cash/cash-ledger.resolver";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { SettlementLedger } from "../settlement/settlement-ledger";
import { LotterySettlementResolver } from "../settlement/settlement.resolver";
import { SettlementService } from "../settlement/settlement.service";
import { AccountNames } from "./account-names";
import { AccountsAccess } from "./accounts-access";
import { AccountsBadge } from "./accounts-badge";
import { LotteryBankAccountsResolver } from "./accounts.resolver";
import { BankAccountsService } from "./bank-accounts.service";
import { BankTransactionsService } from "./bank-transactions.service";

/**
 * 帳戶管理(`accounts`,專案規格第 9 章、10.1–10.3;正本 `docs/modules/project/accounts.md`):
 * 銀行帳戶與交易、即時現金帳與現金流水、收付機制、待結清款項與側欄數字。
 *
 * 匯出給其他刮刮樂功能:`CashLedgerService`(現金流水寫入的唯一入口)、`SettlementLedger`
 * (作廢 / 駁回守門 `settlementClearedGuard` 要 inject 它)、`SettlementService`、`BankTransactionsService`。
 */
@Module({
  imports: [DatabaseModule, RealtimeModule, SidebarBadgesModule],
  providers: [
    AccountsAccess,
    AccountNames,
    CashLedgerService,
    CashLedgerViewService,
    SettlementLedger,
    BankTransactionsService,
    BankAccountsService,
    SettlementService,
    LotteryBankAccountsResolver,
    LotteryCashLedgerResolver,
    LotterySettlementResolver,
    AccountsBadge,
  ],
  exports: [
    CashLedgerService,
    SettlementLedger,
    SettlementService,
    BankTransactionsService,
  ],
})
export class LotteryAccountsModule {}
