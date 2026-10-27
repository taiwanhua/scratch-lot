import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { NotificationsModule } from "../../../notifications/notifications.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { ScheduledJobsModule } from "../../../scheduled-jobs/scheduled-jobs.module";
import { SidebarBadgesModule } from "../../../sidebar-badges/sidebar-badges.module";
import { DealerBadge } from "./dealer-badge";
import { DealerContactsService } from "./dealer-contacts.service";
import { DealerLinksService } from "./dealer-links.service";
import { DealerRemindersService } from "./dealer-reminders.service";
import { DealerSigninsService } from "./dealer-signins.service";
import { DealerViewService } from "./dealer-view.service";
import { DealersAccess } from "./dealers-access";
import {
  LotteryDealerContactsResolver,
  LotteryDealersResolver,
} from "./dealers.resolver";
import { LotteryDealersService } from "./dealers.service";
import { DealerPurchaseDates } from "./purchase-dates";

/**
 * 經銷商管理(`dealers`,專案規格 5.2–5.4;正本 `docs/modules/project/dealers.md`):
 * 甲類、乙類、關係人、關聯、見簽、側欄計數、證照到期 / 牌租繳費提醒。
 * 稽核與權限解析由 @Global 的 AuditModule / PermissionModule 提供。
 * `DealerPurchaseDates` 匯出給進貨單(送出 / 駁回 / 作廢時重算批購日)。
 */
@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    RealtimeModule,
    ScheduledJobsModule,
    SidebarBadgesModule,
  ],
  providers: [
    DealersAccess,
    DealerLinksService,
    DealerViewService,
    DealerPurchaseDates,
    LotteryDealersService,
    DealerSigninsService,
    DealerContactsService,
    LotteryDealersResolver,
    LotteryDealerContactsResolver,
    DealerBadge,
    DealerRemindersService,
  ],
  exports: [LotteryDealersService, DealerPurchaseDates],
})
export class LotteryDealersModule {}
