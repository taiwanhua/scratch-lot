import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryPurchaseReceipt } from "./lottery-purchase-receipt.schema";

export type LotteryPurchaseReceiptDocument =
  HydratedDocument<LotteryPurchaseReceipt>;

/** lottery_purchase_receipts(進貨點收,專案規格 8.3)。 */
@Injectable()
export class LotteryPurchaseReceiptsRepository extends BaseRepository<
  LotteryPurchaseReceipt,
  LotteryPurchaseReceiptDocument
> {
  constructor(
    @InjectModel(LotteryPurchaseReceipt.name)
    model: RepositoryModel<
      LotteryPurchaseReceipt,
      LotteryPurchaseReceiptDocument
    >,
  ) {
    super(model);
  }
}
