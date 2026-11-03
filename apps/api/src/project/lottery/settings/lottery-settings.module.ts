import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { LotterySettingsResolver } from "./lottery-settings.resolver";
import { LotterySettingsService } from "./lottery-settings.service";
import { StoreCountModeService } from "./store-count-mode.service";

/**
 * 刮刮樂設定(`lottery-settings`,張數店規格第 4 節、5.5、5.6;正本 `docs/modules/project/lottery-settings.md`):
 * 設定頁(沿組織樹的 [自訂] / [還原])、改盤點制度(同一個交易重算下層分店)、[取消轉換]、[變更紀錄]。
 * 匯出 `StoreCountModeService`:分店實際盤點制度的唯一讀寫入口,之後的銷售、盤點、重刷、補點、調貨、關帳都經它讀。
 * 稽核與權限解析由 @Global 的 AuditModule / PermissionModule 提供。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    StoreCountModeService,
    LotterySettingsService,
    LotterySettingsResolver,
  ],
  exports: [StoreCountModeService],
})
export class LotterySettingsModule {}
