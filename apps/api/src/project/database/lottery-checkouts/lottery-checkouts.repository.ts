import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryCheckout } from "./lottery-checkout.schema";

export type LotteryCheckoutDocument = HydratedDocument<LotteryCheckout>;

/** lottery_checkouts(結帳單,專案規格 6.9、8.7)。 */
@Injectable()
export class LotteryCheckoutsRepository extends BaseRepository<
  LotteryCheckout,
  LotteryCheckoutDocument
> {
  constructor(
    @InjectModel(LotteryCheckout.name)
    model: RepositoryModel<LotteryCheckout, LotteryCheckoutDocument>,
  ) {
    super(model);
  }
}
