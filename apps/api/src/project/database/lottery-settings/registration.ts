import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_SETTINGS_COLLECTION,
  LotterySetting,
  LotterySettingSchema,
} from "./lottery-setting.schema";
import {
  LotterySettingsRepository,
  LotteryStoreCountModesRepository,
} from "./lottery-settings.repositories";
import {
  LOTTERY_STORE_COUNT_MODES_COLLECTION,
  LotteryStoreCountMode,
  LotteryStoreCountModeSchema,
} from "./lottery-store-count-mode.schema";

/** 刮刮樂設定的資料登記:設定的自訂、分店實際盤點制度兩張模組資料表,各一個 BaseRepository 與組織歸屬檢查。 */
export const LOTTERY_SETTINGS_REGISTRATION: DatabaseRegistration = {
  key: "lottery-settings",
  models: [
    {
      name: LotterySetting.name,
      collection: LOTTERY_SETTINGS_COLLECTION,
      schema: LotterySettingSchema,
    },
    {
      name: LotteryStoreCountMode.name,
      collection: LOTTERY_STORE_COUNT_MODES_COLLECTION,
      schema: LotteryStoreCountModeSchema,
    },
  ],
  repositories: [
    { modelName: LotterySetting.name, provider: LotterySettingsRepository },
    {
      modelName: LotteryStoreCountMode.name,
      provider: LotteryStoreCountModesRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-settings",
      modelName: LotterySetting.name,
      repository: LotterySettingsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-store-count-modes",
      modelName: LotteryStoreCountMode.name,
      repository: LotteryStoreCountModesRepository,
      ownerField: "orgId",
    },
  ],
};
