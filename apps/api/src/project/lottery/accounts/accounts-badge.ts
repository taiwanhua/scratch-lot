import { Injectable, type OnModuleInit } from "@nestjs/common";

import { ACCOUNTS_KEY } from "@repo/domain/project/lottery-accounts";

import { SidebarBadgeRegistry } from "../../../sidebar-badges/sidebar-badge-registry";
import { SettlementService } from "../settlement/settlement.service";

/**
 * 側欄「帳戶管理」的數字(專案規格 10.3、第 9 章;底座 10.4 登記制):待結清款項的筆數
 * (有待付 / 待退 / 待收的每一邊算一筆),範圍照操作者的可見範圍;沒有 `view-outstanding` = 0。
 * 收付寫入後對操作者送 `badge:accounts`(`SettlementService` / `BankTransactionsService`)。
 */
@Injectable()
export class AccountsBadge implements OnModuleInit {
  constructor(
    private readonly registry: SidebarBadgeRegistry,
    private readonly settlement: SettlementService,
  ) {}

  onModuleInit(): void {
    this.registry.registerBadge({
      moduleKey: ACCOUNTS_KEY,
      // 通知設定頁「側欄數字」的說明(專案字典)
      descriptionKey: "admin.lotteryAccounts.badgeDescription",
      count: (operator) => this.settlement.outstandingCount(operator),
    });
  }
}
