import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_SHIFTS_COLLECTION,
  LotteryShift,
  LotteryShiftSchema,
} from "./lottery-shift.schema";
import { LotteryShiftsRepository } from "./lottery-shifts.repository";

/** 收銀班次的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_STORE_REGISTRATION: DatabaseRegistration = {
  key: "lottery-store",
  models: [
    {
      name: LotteryShift.name,
      collection: LOTTERY_SHIFTS_COLLECTION,
      schema: LotteryShiftSchema,
    },
  ],
  repositories: [
    { modelName: LotteryShift.name, provider: LotteryShiftsRepository },
  ],
  orgDataChecks: [
    {
      key: "lottery-shifts",
      modelName: LotteryShift.name,
      repository: LotteryShiftsRepository,
      ownerField: "orgId",
    },
  ],
};
