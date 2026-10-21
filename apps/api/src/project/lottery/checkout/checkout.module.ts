import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { FormsCoreModule } from "../../../forms/forms-core.module";
import { RealtimeModule } from "../../../realtime/realtime.module";
import { WorkflowEngineModule } from "../../../workflows/workflow-engine/workflow-engine.module";
import { LotteryFieldOptionsModule } from "../field-options/lottery-field-options.module";
import { LotteryRedemptionModule } from "../redemption/redemption.module";
import { LotteryStocktakeModule } from "../stocktake/stocktake.module";
import { LotteryStoreModule } from "../store/store.module";
import { CheckoutQueryService } from "./checkout-query.service";
import { CheckoutRegistrations } from "./checkout-registrations";
import { LotteryCheckoutResolver } from "./checkout.resolver";
import { CheckoutService } from "./checkout.service";
import { CHECKOUT_SERVICE } from "./checkout.token";
import { ExpectedCashItems } from "./expected-cash";

/**
 * 交班結帳(店面管理的一個功能,專案規格 6.9、8.7;正本 `docs/modules/project/store.md`「交班結帳」):
 * 交班精靈的資料、結帳確認申請的掛接點(`checkout-lifecycle.ts`,以 `CHECKOUT_SERVICE` 取服務)、班次結帳歷史紀錄
 * 與檢視頁;向店面登記「留給下一班」(`CheckoutRegistrations`)。盤點經 `LotteryStocktakeModule` 的
 * `StocktakeService`;兌獎的畫面模型沿用 `RedemptionViews`;店、班與抽屜的讀取沿用店面模組匯出的服務。
 */
@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    FormsCoreModule,
    WorkflowEngineModule,
    LotteryFieldOptionsModule,
    LotteryStoreModule,
    LotteryStocktakeModule,
    LotteryRedemptionModule,
  ],
  providers: [
    ExpectedCashItems,
    CheckoutService,
    CheckoutQueryService,
    CheckoutRegistrations,
    LotteryCheckoutResolver,
    { provide: CHECKOUT_SERVICE, useExisting: CheckoutService },
  ],
  exports: [CHECKOUT_SERVICE, CheckoutService, ExpectedCashItems],
})
export class LotteryCheckoutModule {}
