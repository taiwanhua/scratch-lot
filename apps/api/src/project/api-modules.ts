import type { ApiFeatureRegistration } from "../base/api-feature-registration";
import { FieldOptionColorsModule } from "./field-option-colors/field-option-colors.module";
import { LotteryAccountsModule } from "./lottery/accounts/accounts.module";
import { LotteryCheckoutModule } from "./lottery/checkout/checkout.module";
import { LotteryDailyCloseModule } from "./lottery/daily-close/daily-close.module";
import { LotteryDealersModule } from "./lottery/dealers/dealers.module";
import { LotteryInventoryModule } from "./lottery/inventory/inventory.module";
import { LotteryMasterDataModule } from "./lottery/master-data.module";
import { LotteryPeriodCloseModule } from "./lottery/period-close/period-close.module";
import { LotteryPurchaseModule } from "./lottery/purchase/purchase.module";
import { LotteryRedemptionModule } from "./lottery/redemption/redemption.module";
import { LotteryRequisitionModule } from "./lottery/requisition/requisition.module";
import { LotteryStocktakeModule } from "./lottery/stocktake/stocktake.module";
import { LotteryStoreModule } from "./lottery/store/store.module";
import { LotteryTicketsModule } from "./lottery/tickets/tickets.module";
import { LotteryTransferModule } from "./lottery/transfer/transfer.module";
import { ScheduleModule } from "./schedule/schedule.module";

/**
 * 專案的 API 功能清單(docs/standards/general/structure.md「STRUCT-12」api)。
 * 新增專案功能:在 `project/<業務>/` 寫普通的 Nest module,再到這裡加一筆;
 * 不必動 `app.module.ts` 與底座清單。key 與 module 都不可與底座或其他專案功能重複。
 */
export const PROJECT_API_MODULES: readonly ApiFeatureRegistration[] = [
  { key: "field-option-colors", module: FieldOptionColorsModule },
  { key: "lottery-master-data", module: LotteryMasterDataModule },
  { key: "lottery-dealers", module: LotteryDealersModule },
  { key: "schedule", module: ScheduleModule },
  { key: "lottery-tickets", module: LotteryTicketsModule },
  { key: "lottery-accounts", module: LotteryAccountsModule },
  { key: "lottery-requisition", module: LotteryRequisitionModule },
  { key: "lottery-inventory", module: LotteryInventoryModule },
  { key: "lottery-purchase", module: LotteryPurchaseModule },
  { key: "lottery-transfer", module: LotteryTransferModule },
  { key: "lottery-store", module: LotteryStoreModule },
  { key: "lottery-redemption", module: LotteryRedemptionModule },
  { key: "lottery-stocktake", module: LotteryStocktakeModule },
  { key: "lottery-checkout", module: LotteryCheckoutModule },
  { key: "lottery-daily-close", module: LotteryDailyCloseModule },
  { key: "lottery-period-close", module: LotteryPeriodCloseModule },
];
