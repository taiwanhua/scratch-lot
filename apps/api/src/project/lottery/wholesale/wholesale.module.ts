import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { SidebarBadgesModule } from "../../../sidebar-badges/sidebar-badges.module";
import { LotteryAccountsModule } from "../accounts/accounts.module";
import { LotteryDealersModule } from "../dealers/dealers.module";
import { LotteryTicketsModule } from "../tickets/tickets.module";
import { WholesaleBooks } from "./wholesale-books.service";
import { WholesaleCustomerNames } from "./wholesale-customer-names";
import { WholesaleQueryService } from "./wholesale-query.service";
import { WholesaleRegistrations } from "./wholesale-registrations";
import { WholesaleRules } from "./wholesale-rules.service";
import { WHOLESALE_RULES } from "./wholesale-rules.token";
import { WholesaleResolver } from "./wholesale.resolver";

/**
 * 批售單(`purchasing.wholesale`,專案規格第 21 章;正本 `docs/modules/project/purchasing.md`「批售單」):
 * 掛接點的規則(`WholesaleRules`,`project/form-lifecycles.ts` 登記)、新增頁選項、列表、檢視頁、批售客戶的批售紀錄;
 * 向其他功能登記收付、批售客戶的來源與側欄計數(`WholesaleRegistrations`)。
 */
@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    SidebarBadgesModule,
    LotteryAccountsModule,
    LotteryDealersModule,
    LotteryTicketsModule,
  ],
  providers: [
    WholesaleRules,
    // 掛接點以 token 取規則(避免登記檔 import 服務造成循環)
    { provide: WHOLESALE_RULES, useExisting: WholesaleRules },
    WholesaleBooks,
    WholesaleCustomerNames,
    WholesaleRegistrations,
    WholesaleQueryService,
    WholesaleResolver,
  ],
  // 營運報表 2b 的客戶店名(同批售單列表的讀法)
  exports: [WholesaleCustomerNames],
})
export class LotteryWholesaleModule {}
