import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryTransferReceipt } from "./lottery-transfer-receipt.schema";

export type LotteryTransferReceiptDocument =
  HydratedDocument<LotteryTransferReceipt>;

/** lottery_transfer_receipts(調貨點收,專案規格 8.4)。 */
@Injectable()
export class LotteryTransferReceiptsRepository extends BaseRepository<
  LotteryTransferReceipt,
  LotteryTransferReceiptDocument
> {
  constructor(
    @InjectModel(LotteryTransferReceipt.name)
    model: RepositoryModel<
      LotteryTransferReceipt,
      LotteryTransferReceiptDocument
    >,
  ) {
    super(model);
  }
}
