import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryStocktake } from "./lottery-stocktake.schema";

export type LotteryStocktakeDocument = HydratedDocument<LotteryStocktake>;

/** lottery_stocktakes(盤點單,專案規格 6.8、8.6)。 */
@Injectable()
export class LotteryStocktakesRepository extends BaseRepository<
  LotteryStocktake,
  LotteryStocktakeDocument
> {
  constructor(
    @InjectModel(LotteryStocktake.name)
    model: RepositoryModel<LotteryStocktake, LotteryStocktakeDocument>,
  ) {
    super(model);
  }
}
