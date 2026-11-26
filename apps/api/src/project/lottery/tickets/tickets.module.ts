import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { LotteryAllocationsService } from "./allocations.service";
import { BookGameUsage } from "./book-game-usage";
import { LotteryBooksService } from "./books.service";
import { TicketLedgerService } from "./ticket-ledger.service";
import { TicketLockDocuments } from "./ticket-lock-documents";
import { WholesaleLedger } from "./wholesale-ledger.service";

/**
 * 張數核心(專案規格 7.1、7.2、7.6;正本 `docs/modules/project/inventory.md`「資料與帳本」):
 * 本 / 張 / 張數事件的帳本、本的建立與即時計算、預計要給本數。沒有 GraphQL 入口 ——
 * 進貨、調貨、店面、盤點、庫存管理各自的 service 注入這裡匯出的三個服務。
 * 稽核由 @Global 的 AuditModule 提供。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    TicketLedgerService,
    LotteryBooksService,
    LotteryAllocationsService,
    BookGameUsage,
    TicketLockDocuments,
    WholesaleLedger,
  ],
  exports: [
    TicketLedgerService,
    LotteryBooksService,
    LotteryAllocationsService,
    // 鎖住張的單據的單號(店面刷到、調貨選張)
    TicketLockDocuments,
    // 批售的出貨與取消(批售單掛接點)
    WholesaleLedger,
  ],
})
export class LotteryTicketsModule {}
