import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryCashPoint } from "./lottery-cash-point.schema";

export type LotteryCashPointDocument = HydratedDocument<LotteryCashPoint>;

/** lottery_cash_points(收銀點,專案規格 5.5)。 */
@Injectable()
export class LotteryCashPointsRepository extends BaseRepository<
  LotteryCashPoint,
  LotteryCashPointDocument
> {
  constructor(
    @InjectModel(LotteryCashPoint.name)
    model: RepositoryModel<LotteryCashPoint, LotteryCashPointDocument>,
  ) {
    super(model);
  }
}
