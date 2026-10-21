import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { NotificationsModule } from "../../../notifications/notifications.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { SidebarBadgesModule } from "../../../sidebar-badges/sidebar-badges.module";
import { LotteryAccountsModule } from "../accounts/accounts.module";
import { LotteryRequisitionModule } from "../requisition/requisition.module";
import { LotteryTicketsModule } from "../tickets/tickets.module";
import { TransferAccess } from "./transfer-access";
import { TransferQueryService } from "./transfer-query.service";
import { TransferReceivingService } from "./transfer-receiving.service";
import { TransferRegistrations } from "./transfer-registrations";
import { TransferRules } from "./transfer-rules.service";
import { TRANSFER_RULES } from "./transfer-rules.token";
import { TransferResolver } from "./transfer.resolver";

/**
 * 調貨單(`purchasing.transfer`,專案規格 8.4、第 9 章;正本 `docs/modules/project/purchasing.md`「調貨單」):
 * 掛接點的規則(`TransferRules`,`project/form-lifecycles.ts` 登記)、點收、新增頁選項與張數格子、列表進度;
 * 向其他功能登記在途、收付與側欄計數(`TransferRegistrations`)。
 */
@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    RealtimeModule,
    SidebarBadgesModule,
    LotteryAccountsModule,
    LotteryRequisitionModule,
    LotteryTicketsModule,
  ],
  providers: [
    TransferRules,
    // 掛接點以 token 取規則(避免登記檔 import 服務造成循環)
    { provide: TRANSFER_RULES, useExisting: TransferRules },
    TransferAccess,
    TransferRegistrations,
    TransferQueryService,
    TransferReceivingService,
    TransferResolver,
  ],
})
export class LotteryTransferModule {}
