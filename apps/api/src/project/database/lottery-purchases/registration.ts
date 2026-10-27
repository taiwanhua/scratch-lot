import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_PURCHASE_RECEIPTS_COLLECTION,
  LotteryPurchaseReceipt,
  LotteryPurchaseReceiptSchema,
} from "./lottery-purchase-receipt.schema";
import { LotteryPurchaseReceiptsRepository } from "./lottery-purchase-receipts.repository";

/** 進貨點收的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_PURCHASES_REGISTRATION: DatabaseRegistration = {
  key: "lottery-purchases",
  models: [
    {
      name: LotteryPurchaseReceipt.name,
      collection: LOTTERY_PURCHASE_RECEIPTS_COLLECTION,
      schema: LotteryPurchaseReceiptSchema,
    },
  ],
  repositories: [
    {
      modelName: LotteryPurchaseReceipt.name,
      provider: LotteryPurchaseReceiptsRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-purchase-receipts",
      modelName: LotteryPurchaseReceipt.name,
      repository: LotteryPurchaseReceiptsRepository,
      ownerField: "orgId",
    },
  ],
};
