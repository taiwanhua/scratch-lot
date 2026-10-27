import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_REDEMPTIONS_COLLECTION,
  LotteryRedemption,
  LotteryRedemptionSchema,
} from "./lottery-redemption.schema";
import { LotteryRedemptionsRepository } from "./lottery-redemptions.repository";

/** 兌獎紀錄的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_REDEMPTIONS_REGISTRATION: DatabaseRegistration = {
  key: "lottery-redemptions",
  models: [
    {
      name: LotteryRedemption.name,
      collection: LOTTERY_REDEMPTIONS_COLLECTION,
      schema: LotteryRedemptionSchema,
    },
  ],
  repositories: [
    {
      modelName: LotteryRedemption.name,
      provider: LotteryRedemptionsRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-redemptions",
      modelName: LotteryRedemption.name,
      repository: LotteryRedemptionsRepository,
      ownerField: "orgId",
    },
  ],
};
