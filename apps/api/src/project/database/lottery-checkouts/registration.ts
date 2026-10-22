import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_CHECKOUTS_COLLECTION,
  LotteryCheckout,
  LotteryCheckoutSchema,
} from "./lottery-checkout.schema";
import { LotteryCheckoutsRepository } from "./lottery-checkouts.repository";

/** 結帳單的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_CHECKOUTS_REGISTRATION: DatabaseRegistration = {
  key: "lottery-checkouts",
  models: [
    {
      name: LotteryCheckout.name,
      collection: LOTTERY_CHECKOUTS_COLLECTION,
      schema: LotteryCheckoutSchema,
    },
  ],
  repositories: [
    {
      modelName: LotteryCheckout.name,
      provider: LotteryCheckoutsRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-checkouts",
      modelName: LotteryCheckout.name,
      repository: LotteryCheckoutsRepository,
      ownerField: "orgId",
    },
  ],
};
