import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_STOCKTAKES_COLLECTION,
  LotteryStocktake,
  LotteryStocktakeSchema,
} from "./lottery-stocktake.schema";
import { LotteryStocktakesRepository } from "./lottery-stocktakes.repository";

/** 盤點單的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_STOCKTAKES_REGISTRATION: DatabaseRegistration = {
  key: "lottery-stocktakes",
  models: [
    {
      name: LotteryStocktake.name,
      collection: LOTTERY_STOCKTAKES_COLLECTION,
      schema: LotteryStocktakeSchema,
    },
  ],
  repositories: [
    {
      modelName: LotteryStocktake.name,
      provider: LotteryStocktakesRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-stocktakes",
      modelName: LotteryStocktake.name,
      repository: LotteryStocktakesRepository,
      ownerField: "orgId",
    },
  ],
};
