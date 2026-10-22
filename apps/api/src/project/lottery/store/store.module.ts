import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { ScheduleModule } from "../../schedule/schedule.module";
import { LotteryAccountsModule } from "../accounts/accounts.module";
import { LotteryFieldOptionsModule } from "../field-options/lottery-field-options.module";
import { LotteryTicketsModule } from "../tickets/tickets.module";
import { ReceiptLinksService } from "./receipt-links.service";
import { StoreShiftViews } from "./shift-views";
import { StoreAccess } from "./store-access";
import { StoreBoardService } from "./store-board.service";
import { StoreCashService } from "./store-cash.service";
import { StoreClock } from "./store-clock";
import { StoreCounterService } from "./store-counter.service";
import { StoreFormsQueryService } from "./store-forms-query.service";
import { StoreFormsRules } from "./store-forms-rules.service";
import { STORE_FORMS_RULES } from "./store-forms-rules.token";
import { LotteryStoreFormsResolver } from "./store-forms.resolver";
import { StorePersonLocks } from "./store-person-locks";
import { StoreRegistrations } from "./store-registrations";
import { StoreSalesSupport } from "./store-sales-support";
import { LotteryStoreSalesResolver } from "./store-sales.resolver";
import { StoreSalesService } from "./store-sales.service";
import { StoreShiftsService } from "./store-shifts.service";
import { StoreVaultGuard } from "./store-vault-guard";
import { LotteryStoreResolver } from "./store.resolver";

/**
 * 店面管理(`store`,專案規格第 6 章;正本 `docs/modules/project/store.md`):看板、本機收銀點、
 * 收銀班次(開班、班次資訊、改對應排班)、投庫 / 出庫、抽屜應有與即時同步;銷售、當下撤銷、拆本、移櫃 / 收回;
 * 撤銷售出申請、現金更正單(掛接點規則與查詢)
 * (張的狀態與事件經 `LotteryTicketsModule` 的 `TicketLedgerService` 寫)。
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
    LotteryTicketsModule,
  ],
  providers: [
    StoreAccess,
    StoreClock,
    StorePersonLocks,
    StoreVaultGuard,
    StoreShiftViews,
    StoreBoardService,
    StoreShiftsService,
    StoreCashService,
    StoreRegistrations,
    // 58mm 單據 QR code 的頁面路由(依模組樹)
    ReceiptLinksService,
    LotteryStoreResolver,
    // 銷售、當下撤銷、拆本、移櫃 / 收回(規格 6.2–6.4)
    StoreSalesSupport,
    StoreSalesService,
    StoreCounterService,
    LotteryStoreSalesResolver,
    // 撤銷售出申請、現金更正單(規格 8.5、8.8):掛接點的規則(`project/form-lifecycles.ts` 登記)與查詢
    StoreFormsRules,
    // 掛接點以 token 取規則(避免登記檔 import 服務造成循環)
    { provide: STORE_FORMS_RULES, useExisting: StoreFormsRules },
    StoreFormsQueryService,
    LotteryStoreFormsResolver,
  ],
  // 給交班結帳(結帳的功能)讀審核中的現金影響;盤點(`stocktake/`)沿用店、收銀點、班與抽屜的讀取與
  // 同一個「現在」(測試注入時間的是同一個實例)
  exports: [
    StoreFormsQueryService,
    StoreAccess,
    StoreClock,
    StoreSalesSupport,
    StoreShiftViews,
    // 存銀行 / 日結(`daily-close/`)動小金庫:同一個守門文件序列化
    StoreVaultGuard,
  ],
})
export class LotteryStoreModule {}
