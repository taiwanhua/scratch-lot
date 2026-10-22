import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { NotificationsModule } from "../../../notifications/notifications.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { SidebarBadgesModule } from "../../../sidebar-badges/sidebar-badges.module";
import { LotteryAccountsModule } from "../accounts/accounts.module";
import { LotteryDealersModule } from "../dealers/dealers.module";
import { LotteryRedemptionModule } from "../redemption/redemption.module";
import { LotteryRequisitionModule } from "../requisition/requisition.module";
import { LotteryTicketsModule } from "../tickets/tickets.module";
import { PurchaseQueryService } from "./purchase-query.service";
import { PurchaseReceivingService } from "./purchase-receiving.service";
import { PurchaseRegistrations } from "./purchase-registrations";
import { PurchaseRules } from "./purchase-rules.service";
import { PURCHASE_RULES } from "./purchase-rules.token";
import { PurchaseResolver } from "./purchase.resolver";

/**
 * 進貨單(`purchasing.purchase`,專案規格 8.2、8.3;正本 `docs/modules/project/purchasing.md`「進貨單」):
 * 掛接點的規則(`PurchaseRules`,`project/form-lifecycles.ts` 登記)、點收、新增頁選項、列表進度、
 * 甲類的批購紀錄;向其他功能登記遊戲引用、在途、收付、批購日來源與側欄計數(`PurchaseRegistrations`)。
 */
@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    RealtimeModule,
    SidebarBadgesModule,
    LotteryAccountsModule,
    LotteryDealersModule,
    LotteryRedemptionModule,
    LotteryRequisitionModule,
    LotteryTicketsModule,
  ],
  providers: [
    PurchaseRules,
    // 掛接點以 token 取規則(避免登記檔 import 服務造成循環)
    { provide: PURCHASE_RULES, useExisting: PurchaseRules },
    PurchaseRegistrations,
    PurchaseQueryService,
    PurchaseReceivingService,
    PurchaseResolver,
  ],
})
export class LotteryPurchaseModule {}
