import type {
  FormSubmissionFieldsFragment,
  LotteryPurchaseReceivingFieldsFragment,
} from "@repo/graphql";

import { ReceivingBatchPrint } from "@/components/project/lottery/ReceiptPrint/ReceivingBatchPrint";
import { purchaseReceivingInputOf } from "@/lib/project/lottery/receipts/purchase-receiving-receipt";

export interface PurchaseReceiptPrintProps {
  submission: FormSubmissionFieldsFragment;
  receiving: LotteryPurchaseReceivingFieldsFragment;
  /** 這張進貨單在後台的連結(QR code) */
  url: string;
}

/**
 * 標頭的 [列印] / [補印] 進貨點收單:一次點收一張單據(點收批次選單、補印和原單一致見 `ReceivingBatchPrint`)。
 * 兩聯(店鋪留存、送貨人留存)一次印;補印可選兩聯都補或其中一聯。
 */
export const PurchaseReceiptPrint = ({
  submission,
  receiving,
  url,
}: PurchaseReceiptPrintProps) => (
  <ReceivingBatchPrint
    kind="purchase-receiving"
    batches={receiving.batches}
    receivedCount={receiving.receivedCount}
    payloadOf={(batch) =>
      purchaseReceivingInputOf(submission, receiving, batch, url)
    }
  />
);
