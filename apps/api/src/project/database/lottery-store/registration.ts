import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_SHIFT_PERSON_LOCKS_COLLECTION,
  LotteryShiftPersonLock,
  LotteryShiftPersonLockSchema,
} from "./lottery-shift-person-lock.schema";
import {
  LOTTERY_SHIFTS_COLLECTION,
  LotteryShift,
  LotteryShiftSchema,
} from "./lottery-shift.schema";
import {
  LotteryShiftPersonLocksRepository,
  LotteryShiftsRepository,
} from "./lottery-shifts.repository";

/** 收銀班次的資料登記:班次與開班的「人」守門文件兩張模組資料表,各一個 BaseRepository 與組織歸屬檢查。 */
export const LOTTERY_STORE_REGISTRATION: DatabaseRegistration = {
  key: "lottery-store",
  models: [
    {
      name: LotteryShift.name,
      collection: LOTTERY_SHIFTS_COLLECTION,
      schema: LotteryShiftSchema,
    },
    {
      name: LotteryShiftPersonLock.name,
      collection: LOTTERY_SHIFT_PERSON_LOCKS_COLLECTION,
      schema: LotteryShiftPersonLockSchema,
    },
  ],
  repositories: [
    { modelName: LotteryShift.name, provider: LotteryShiftsRepository },
    {
      modelName: LotteryShiftPersonLock.name,
      provider: LotteryShiftPersonLocksRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-shifts",
      modelName: LotteryShift.name,
      repository: LotteryShiftsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-shift-person-locks",
      modelName: LotteryShiftPersonLock.name,
      repository: LotteryShiftPersonLocksRepository,
      ownerField: "orgId",
    },
  ],
};
