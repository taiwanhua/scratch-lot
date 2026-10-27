import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryRequisitionLine } from "./lottery-requisition-line.schema";

export type LotteryRequisitionLineDocument =
  HydratedDocument<LotteryRequisitionLine>;

/** lottery_requisition_lines(叫貨明細副本,專案規格 8.1)。 */
@Injectable()
export class LotteryRequisitionLinesRepository extends BaseRepository<
  LotteryRequisitionLine,
  LotteryRequisitionLineDocument
> {
  constructor(
    @InjectModel(LotteryRequisitionLine.name)
    model: RepositoryModel<
      LotteryRequisitionLine,
      LotteryRequisitionLineDocument
    >,
  ) {
    super(model);
  }
}
