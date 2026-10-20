import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_GAMES_COLLECTION,
  LotteryGame,
  LotteryGameSchema,
} from "./lottery-game.schema";
import { LotteryGamesRepository } from "./lottery-games.repository";

/** 遊戲的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_GAMES_REGISTRATION: DatabaseRegistration = {
  key: "lottery-games",
  models: [
    {
      name: LotteryGame.name,
      collection: LOTTERY_GAMES_COLLECTION,
      schema: LotteryGameSchema,
    },
  ],
  repositories: [
    { modelName: LotteryGame.name, provider: LotteryGamesRepository },
  ],
  orgDataChecks: [
    {
      key: "lottery-games",
      modelName: LotteryGame.name,
      repository: LotteryGamesRepository,
      ownerField: "orgId",
    },
  ],
};
