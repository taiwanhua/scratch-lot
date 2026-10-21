import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { NotificationsModule } from "../../../notifications/notifications.module";
import { ScheduledJobsModule } from "../../../scheduled-jobs/scheduled-jobs.module";
import { LotteryAccountsModule } from "../accounts/accounts.module";
import { LotteryStoreModule } from "../store/store.module";
import { PeriodCloseRemindersService } from "./period-close-reminders.service";
import { LotteryPeriodCloseResolver } from "./period-close.resolver";
import { PeriodCloseService } from "./period-close.service";

/**
 * 關帳(帳戶管理的一個分頁,專案規格 10.4、3.4 關帳逾期;正本 `docs/modules/project/accounts.md`「關帳」):
 * 月份列表、檢查清單 + 快照、[關帳]、關帳逾期提醒。「不能選已關帳月份」的檢查 `PeriodLock` 在帳戶管理
 * (`LotteryAccountsModule` 匯出,店面也用);這裡要讀班、結帳單與單據,所以另成一個 module(帳戶管理不依賴店面)。
 * 「現在」沿用店面的 `StoreClock`(測試注入同一個實例)。
 */
@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    ScheduledJobsModule,
    LotteryAccountsModule,
    LotteryStoreModule,
  ],
  providers: [
    PeriodCloseService,
    PeriodCloseRemindersService,
    LotteryPeriodCloseResolver,
  ],
})
export class LotteryPeriodCloseModule {}
