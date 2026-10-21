import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { SerialsModule } from "../../../serials/serials.module";
import { LotteryFieldOptionsModule } from "../field-options/lottery-field-options.module";
import { StoreAccess } from "../store/store-access";
import { RedemptionPurchaseLink } from "./redemption-purchase-link";
import { RedemptionQueryService } from "./redemption-query.service";
import { RedemptionRegistrations } from "./redemption-registrations";
import { RedemptionViews } from "./redemption-views";
import { LotteryRedemptionResolver } from "./redemption.resolver";
import { RedemptionService } from "./redemption.service";

/**
 * 兌獎(店面管理的一個功能,專案規格 6.5、6.12、8.2;正本 `docs/modules/project/store.md`「兌獎」):
 * 兌獎 / 撤銷兌獎 / [撤銷並重新登記]、兌獎紀錄的讀取、抽屜應有的來源 `redemptions`;
 * 匯出 `RedemptionPurchaseLink` 給進貨單的掛接點(勾選兌獎 → 已送兌 / 回到店內持有)、`RedemptionViews` 給進貨單
 * 檢視頁讀勾選的兌獎紀錄(讀取依據是讀得到那張進貨單)。
 * 班次只讀寫 `lottery_shifts`(抽屜版本),店長判斷沿用店面的 `StoreAccess`;單號由底座 `SerialsModule` 給(ADR-0015)。
 */
@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    SerialsModule,
    LotteryFieldOptionsModule,
  ],
  providers: [
    StoreAccess,
    RedemptionViews,
    RedemptionService,
    RedemptionQueryService,
    RedemptionRegistrations,
    RedemptionPurchaseLink,
    LotteryRedemptionResolver,
  ],
  exports: [RedemptionPurchaseLink, RedemptionViews],
})
export class LotteryRedemptionModule {}
