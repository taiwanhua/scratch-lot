import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { NotificationsModule } from "../../../notifications/notifications.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { ScheduledJobsModule } from "../../../scheduled-jobs/scheduled-jobs.module";
import { SidebarBadgesModule } from "../../../sidebar-badges/sidebar-badges.module";
import { LotteryAccountsModule } from "../accounts/accounts.module";
import { LotteryCheckoutModule } from "../checkout/checkout.module";
import { LotteryStocktakeModule } from "../stocktake/stocktake.module";
import { LotteryStoreModule } from "../store/store.module";
import { BankDepositService } from "./bank-deposit.service";
import { DailyCloseLedger } from "./daily-close-ledger";
import { DailyCloseQueryService } from "./daily-close-query.service";
import { DailyCloseRegistrations } from "./daily-close-registrations";
import { DailyCloseRemindersService } from "./daily-close-reminders.service";
import { LotteryDailyCloseResolver } from "./daily-close.resolver";
import { DailyCloseService } from "./daily-close.service";
import { DAILY_CLOSE_SERVICE } from "./daily-close.token";
import { StoreBadge } from "./store-badge";

/**
 * 日結與存銀行(店面管理的一個功能,專案規格 6.10、6.11、3.4 日結逾期;正本 `docs/modules/project/store.md`
 * 「日結與存銀行」):日結精靈的資料、結帳確認申請(類型 = 日結)的掛接點(`checkout/checkout-lifecycle.ts`
 * 依類型分派,以 `DAILY_CLOSE_SERVICE` 取服務)、[存銀行]、日結逾期提醒與側欄數字;向帳戶管理登記小金庫起算點、
 * 向店面登記「已被日結涵蓋」(`DailyCloseRegistrations`)。盤點與交班結帳的守門 / 寫入沿用 `CheckoutService`。
 */
@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    NotificationsModule,
    ScheduledJobsModule,
    SidebarBadgesModule,
    LotteryAccountsModule,
    LotteryStoreModule,
    LotteryStocktakeModule,
    LotteryCheckoutModule,
  ],
  providers: [
    DailyCloseLedger,
    DailyCloseService,
    DailyCloseQueryService,
    BankDepositService,
    DailyCloseRegistrations,
    DailyCloseRemindersService,
    StoreBadge,
    LotteryDailyCloseResolver,
    { provide: DAILY_CLOSE_SERVICE, useExisting: DailyCloseService },
  ],
  // `DailyCloseLedger`:關帳(`period-close/`)沿用「沒被日結涵蓋計算」的同一個判斷
  exports: [DAILY_CLOSE_SERVICE, DailyCloseService, DailyCloseLedger],
})
export class LotteryDailyCloseModule {}
