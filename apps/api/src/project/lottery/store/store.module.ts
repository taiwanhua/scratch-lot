import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { ScheduleModule } from "../../schedule/schedule.module";
import { LotteryAccountsModule } from "../accounts/accounts.module";
import { LotteryFieldOptionsModule } from "../field-options/lottery-field-options.module";
import { StoreShiftViews } from "./shift-views";
import { StoreAccess } from "./store-access";
import { StoreBoardService } from "./store-board.service";
import { StoreCashService } from "./store-cash.service";
import { StoreClock } from "./store-clock";
import { StoreRegistrations } from "./store-registrations";
import { StoreShiftsService } from "./store-shifts.service";
import { LotteryStoreResolver } from "./store.resolver";

/**
 * 店面管理(`store`,專案規格第 6 章;正本 `docs/modules/project/store.md`):看板、本機收銀點、
 * 收銀班次(開班、班次資訊、改對應排班)、投庫 / 出庫、抽屜應有與即時同步。
 * 現金流水經 `LotteryAccountsModule` 的 `CashLedgerService` 寫;排班只經 `ScheduleModule` 匯出的
 * `ScheduleEntryLookup` 讀;原因檢查用底座 `FieldOptionsService`(經 `LotteryFieldOptionsModule`)。
 * 稽核與權限解析由 @Global 的 AuditModule / PermissionModule 提供。
 */
@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    ScheduleModule,
    LotteryAccountsModule,
    LotteryFieldOptionsModule,
  ],
  providers: [
    StoreAccess,
    StoreClock,
    StoreShiftViews,
    StoreBoardService,
    StoreShiftsService,
    StoreCashService,
    StoreRegistrations,
    LotteryStoreResolver,
  ],
})
export class LotteryStoreModule {}
