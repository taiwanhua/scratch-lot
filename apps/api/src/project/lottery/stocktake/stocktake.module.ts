import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { FormsCoreModule } from "../../../forms/forms-core.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { WorkflowEngineModule } from "../../../workflows/workflow-engine/workflow-engine.module";
import { LotteryFieldOptionsModule } from "../field-options/lottery-field-options.module";
import { LotteryStoreModule } from "../store/store.module";
import { LotteryTicketsModule } from "../tickets/tickets.module";
import { StocktakeFacts } from "./stocktake-facts";
import { StocktakeQueryService } from "./stocktake-query.service";
import { LotteryStocktakeResolver } from "./stocktake.resolver";
import { StocktakeService } from "./stocktake.service";
import { STOCKTAKE_SERVICE } from "./stocktake.token";

/**
 * 盤點(店面管理的一個功能,專案規格 6.8、8.6、7.4;正本 `docs/modules/project/store.md`「盤點」):
 * 盤點頁、差異核對、[補登售出](立即生效,經 `TicketLedgerService`)、盤點紀錄與檢視頁;盤點確認申請的掛接點
 * (`stocktake-lifecycle.ts`)以 `STOCKTAKE_SERVICE` 取服務。交班 / 日結的結帳確認申請(之後的功能)
 * 匯入本模組,以同一個 token 取 `submitStocktakeDraft` 等入口。
 * 店、收銀點、班與抽屜的讀取沿用店面模組匯出的 `StoreSalesSupport` / `StoreShiftViews` / `StoreAccess` / `StoreClock`。
 */
@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    FormsCoreModule,
    WorkflowEngineModule,
    LotteryFieldOptionsModule,
    LotteryTicketsModule,
    LotteryStoreModule,
  ],
  providers: [
    StocktakeFacts,
    StocktakeService,
    StocktakeQueryService,
    LotteryStocktakeResolver,
    { provide: STOCKTAKE_SERVICE, useExisting: StocktakeService },
  ],
  exports: [STOCKTAKE_SERVICE, StocktakeService],
})
export class LotteryStocktakeModule {}
