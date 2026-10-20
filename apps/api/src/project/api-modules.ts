import type { ApiFeatureRegistration } from "../base/api-feature-registration";
import { FieldOptionColorsModule } from "./field-option-colors/field-option-colors.module";
import { LotteryDealersModule } from "./lottery/dealers/dealers.module";
import { LotteryMasterDataModule } from "./lottery/master-data.module";
import { LotteryTicketsModule } from "./lottery/tickets/tickets.module";
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
];
