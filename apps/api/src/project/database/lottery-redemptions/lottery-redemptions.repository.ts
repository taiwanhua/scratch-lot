import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryRedemption } from "./lottery-redemption.schema";

export type LotteryRedemptionDocument = HydratedDocument<LotteryRedemption>;

/** lottery_redemptions(兌獎紀錄,專案規格 6.5)。 */
@Injectable()
export class LotteryRedemptionsRepository extends BaseRepository<
  LotteryRedemption,
  LotteryRedemptionDocument
> {
  constructor(
    @InjectModel(LotteryRedemption.name)
    model: RepositoryModel<LotteryRedemption, LotteryRedemptionDocument>,
  ) {
    super(model);
  }
}
