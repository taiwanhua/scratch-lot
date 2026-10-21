import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_CASH_POINTS_COLLECTION,
  LotteryCashPoint,
  LotteryCashPointSchema,
} from "./lottery-cash-point.schema";
import { LotteryCashPointsRepository } from "./lottery-cash-points.repository";

/** 收銀點的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_CASH_POINTS_REGISTRATION: DatabaseRegistration = {
  key: "lottery-cash-points",
  models: [
    {
      name: LotteryCashPoint.name,
      collection: LOTTERY_CASH_POINTS_COLLECTION,
      schema: LotteryCashPointSchema,
    },
  ],
  repositories: [
    { modelName: LotteryCashPoint.name, provider: LotteryCashPointsRepository },
  ],
  orgDataChecks: [
    {
      key: "lottery-cash-points",
      modelName: LotteryCashPoint.name,
      repository: LotteryCashPointsRepository,
      ownerField: "orgId",
    },
  ],
};
