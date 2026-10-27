import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { LotteryFieldOptionsModule } from "../field-options/lottery-field-options.module";
import { LotteryTicketsModule } from "../tickets/tickets.module";
import { InventoryAccess } from "./inventory-access";
import { InventoryActionsService } from "./inventory-actions.service";
import { InventoryNames } from "./inventory-names";
import { InventoryStockService } from "./inventory-stock.service";
import { InventoryViewService } from "./inventory-view.service";
import { LotteryInventoryResolver } from "./inventory.resolver";

/**
 * 庫存管理(`inventory`,專案規格 7.3、7.4、7.6;正本 `docs/modules/project/inventory.md`):
 * 庫存分頁、查刮刮樂、本的詳情(更正跳號、尋回、報廢)、待查·遺失、預計要給本數與庫存概況。
 * 張的狀態與事件經 `LotteryTicketsModule` 的帳本寫入;原因下拉與檢查是底座的 `FieldOptionsService`(經 `LotteryFieldOptionsModule` 匯入)。
 */
@Module({
  imports: [DatabaseModule, LotteryTicketsModule, LotteryFieldOptionsModule],
  providers: [
    InventoryAccess,
    InventoryNames,
    InventoryViewService,
    InventoryActionsService,
    InventoryStockService,
    LotteryInventoryResolver,
  ],
})
export class LotteryInventoryModule {}
