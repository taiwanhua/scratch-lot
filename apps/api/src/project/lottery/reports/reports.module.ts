import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { ScheduleModule } from "../../schedule/schedule.module";
import { LotteryAccountsModule } from "../accounts/accounts.module";
import { LotteryFieldOptionsModule } from "../field-options/lottery-field-options.module";
import { LotteryStoreModule } from "../store/store.module";
import { OperationsInventory } from "./operations-inventory";
import { OperationsReportService } from "./operations-report.service";
import { PostCloseCorrections } from "./post-close-corrections";
import { ReportPeriods } from "./report-periods";
import { ReportScopes } from "./report-scope";
import { ReportStock } from "./report-stock";
import { LotteryReportsResolver } from "./reports.resolver";
import { ShiftCheckoutsReportService } from "./shift-checkouts-report.service";

/**
 * 輸出報表的刮刮樂報表(專案規格第 11 章;正本 `docs/modules/project/reports.md`):營運報表、班次結帳歷史報表。
 * 外框(期間、分店上限、Excel、預覽)是底座的(`docs/modules/reports.md`;範圍檢查 `src/reports/report-range.ts`);這裡只做查詢。
 * 讀關帳到哪(`PeriodLock`)、收付的待結清與銀行餘額經帳戶管理;班次的人名經店面;協同從排班
 * (`ScheduleEntryLookup`,依賴方向刮刮樂 → 排班)。
 */
@Module({
  imports: [
    DatabaseModule,
    ScheduleModule,
    LotteryAccountsModule,
    LotteryFieldOptionsModule,
    LotteryStoreModule,
  ],
  providers: [
    ReportScopes,
    ReportPeriods,
    PostCloseCorrections,
    ReportStock,
    OperationsInventory,
    OperationsReportService,
    ShiftCheckoutsReportService,
    LotteryReportsResolver,
  ],
})
export class LotteryReportsModule {}
