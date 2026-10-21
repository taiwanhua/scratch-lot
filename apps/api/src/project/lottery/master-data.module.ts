import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { LotteryCashPointsResolver } from "./cash-points/cash-points.resolver";
import { LotteryCashPointsService } from "./cash-points/cash-points.service";
import { LotteryGamesResolver } from "./games/games.resolver";
import { LotteryGamesService } from "./games/games.service";
import { MasterDataAccess } from "./master-data-access";

/**
 * 檔案管理(`master-data`,專案規格 5.1、5.5):遊戲與收銀點。
 * 稽核與權限解析由 @Global 的 AuditModule / PermissionModule 提供。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    MasterDataAccess,
    LotteryGamesService,
    LotteryGamesResolver,
    LotteryCashPointsService,
    LotteryCashPointsResolver,
  ],
  exports: [LotteryGamesService, LotteryCashPointsService],
})
export class LotteryMasterDataModule {}
