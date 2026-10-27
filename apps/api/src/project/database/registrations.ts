import type { DatabaseRegistration } from "../../database/registration";
import { FIELD_OPTION_COLORS_REGISTRATION } from "./field-option-colors/registration";
import { LOTTERY_ACCOUNTS_REGISTRATION } from "./lottery-accounts/registration";
import { LOTTERY_CASH_POINTS_REGISTRATION } from "./lottery-cash-points/registration";
import { LOTTERY_CHECKOUTS_REGISTRATION } from "./lottery-checkouts/registration";
import { LOTTERY_DEALERS_REGISTRATION } from "./lottery-dealers/registration";
import { LOTTERY_GAMES_REGISTRATION } from "./lottery-games/registration";
import { LOTTERY_INVENTORY_REGISTRATION } from "./lottery-inventory/registration";
import { LOTTERY_PURCHASES_REGISTRATION } from "./lottery-purchases/registration";
import { LOTTERY_REDEMPTIONS_REGISTRATION } from "./lottery-redemptions/registration";
import { LOTTERY_REQUISITIONS_REGISTRATION } from "./lottery-requisitions/registration";
import { LOTTERY_STOCKTAKES_REGISTRATION } from "./lottery-stocktakes/registration";
import { LOTTERY_STORE_REGISTRATION } from "./lottery-store/registration";
import { LOTTERY_TRANSFERS_REGISTRATION } from "./lottery-transfers/registration";
import { SCHEDULE_SETTINGS_REGISTRATION } from "./schedule/registration";
import { SCHEDULE_ROSTER_REGISTRATION } from "./schedule/roster-registration";

/**
 * 專案的資料登記(docs/concepts/data-layer-and-isolation.md「底座與專案資料的組裝」)。
 *
 * 新增專案租戶資料時在這裡加一份登記:schema 沿用示範模組的形狀(先以 schema 選項定 collection,
 * 再掛 `baseFieldsPlugin` 與 `tenantScopePlugin`;模組資料用 `moduleData: true`)、
 * repository 繼承 `BaseRepository`,並為每張 model 列一項歸屬欄為 `orgId` 的組織歸屬檢查 ——
 * 少任何一項 app 都起不來。這裡沒有任何「略過檢查」的旗標可用。
 */
export const PROJECT_DATABASE_REGISTRATIONS: readonly DatabaseRegistration[] = [
  FIELD_OPTION_COLORS_REGISTRATION,
  LOTTERY_GAMES_REGISTRATION,
  LOTTERY_CASH_POINTS_REGISTRATION,
  LOTTERY_DEALERS_REGISTRATION,
  SCHEDULE_SETTINGS_REGISTRATION,
  LOTTERY_INVENTORY_REGISTRATION,
  LOTTERY_ACCOUNTS_REGISTRATION,
  SCHEDULE_ROSTER_REGISTRATION,
  LOTTERY_REQUISITIONS_REGISTRATION,
  LOTTERY_PURCHASES_REGISTRATION,
  LOTTERY_TRANSFERS_REGISTRATION,
  LOTTERY_STORE_REGISTRATION,
  LOTTERY_REDEMPTIONS_REGISTRATION,
  LOTTERY_STOCKTAKES_REGISTRATION,
  LOTTERY_CHECKOUTS_REGISTRATION,
];
