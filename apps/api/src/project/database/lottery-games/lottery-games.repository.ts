import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryGame } from "./lottery-game.schema";

export type LotteryGameDocument = HydratedDocument<LotteryGame>;

/** lottery_games(遊戲,專案規格 5.1)。 */
@Injectable()
export class LotteryGamesRepository extends BaseRepository<
  LotteryGame,
  LotteryGameDocument
> {
  constructor(
    @InjectModel(LotteryGame.name)
    model: RepositoryModel<LotteryGame, LotteryGameDocument>,
  ) {
    super(model);
  }
}
