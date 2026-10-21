import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_TRANSFER_RECEIPTS_COLLECTION,
  LotteryTransferReceipt,
  LotteryTransferReceiptSchema,
} from "./lottery-transfer-receipt.schema";
import { LotteryTransferReceiptsRepository } from "./lottery-transfer-receipts.repository";

/** 調貨點收的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_TRANSFERS_REGISTRATION: DatabaseRegistration = {
  key: "lottery-transfers",
  models: [
    {
      name: LotteryTransferReceipt.name,
      collection: LOTTERY_TRANSFER_RECEIPTS_COLLECTION,
      schema: LotteryTransferReceiptSchema,
    },
  ],
  repositories: [
    {
      modelName: LotteryTransferReceipt.name,
      provider: LotteryTransferReceiptsRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-transfer-receipts",
      modelName: LotteryTransferReceipt.name,
      repository: LotteryTransferReceiptsRepository,
      ownerField: "orgId",
    },
  ],
};
