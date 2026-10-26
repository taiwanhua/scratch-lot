import { useTranslations } from "use-intl";

import { ReceiptPrintButton } from "@/components/project/lottery/ReceiptPrint/ReceiptPrintButton";
import { ReceivingBatchPrint } from "@/components/project/lottery/ReceiptPrint/ReceivingBatchPrint";

import type { useTransferReceipts } from "./useTransferReceipts";

/**
 * 調貨單標頭的 [列印](規格 8.4「列印:調貨出貨單、調貨點收單、調貨付款收據」;Figma PU-10a / PU-10b 標頭右上):
 * 每種單據各一顆,前面寫單據名稱;調貨點收單一次點收一張(點過兩次以上時多一個「點收批次」選單);
 * 沒有 `api.printing.print` 時都不出現(底座列印按鈕)。
 */
export const TransferPrintButtons = ({
  receipts,
}: {
  receipts: Pick<
    ReturnType<typeof useTransferReceipts>,
    "shipment" | "receiving" | "payment"
  >;
}) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.view");
  return (
    <>
      {receipts.shipment !== null && (
        <ReceiptPrintButton
          kind="transfer-shipment"
          payload={receipts.shipment}
          label={t("printShipment")}
        />
      )}
      {receipts.receiving !== null && (
        <ReceivingBatchPrint
          kind="transfer-receiving"
          batches={receipts.receiving.batches}
          receivedCount={receipts.receiving.receivedCount}
          payloadOf={receipts.receiving.inputOf}
          label={t("printReceiving")}
        />
      )}
      {receipts.payment !== null && (
        <ReceiptPrintButton
          kind="transfer-payment"
          payload={receipts.payment}
          label={t("printPayment")}
        />
      )}
    </>
  );
};
