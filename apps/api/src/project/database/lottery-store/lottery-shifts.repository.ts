import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryShift } from "./lottery-shift.schema";

export type LotteryShiftDocument = HydratedDocument<LotteryShift>;

/** lottery_shifts(收銀班次,專案規格 6.6)。 */
@Injectable()
export class LotteryShiftsRepository extends BaseRepository<
  LotteryShift,
  LotteryShiftDocument
> {
  constructor(
    @InjectModel(LotteryShift.name)
    model: RepositoryModel<LotteryShift, LotteryShiftDocument>,
  ) {
    super(model);
  }
}
