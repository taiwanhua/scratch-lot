import { useTranslations } from "use-intl";

import { ReceiptPrintButton } from "@/components/project/lottery/ReceiptPrint/ReceiptPrintButton";

import type { useTransferReceipts } from "./useTransferReceipts";

/**
 * 調貨單標頭的 [列印](規格 8.4「列印:調貨出貨單、調貨付款收據」;Figma PU-10a / PU-10b 標頭右上):
 * 兩種單據各一顆,前面寫單據名稱;沒有 `api.printing.print` 時都不出現(底座列印按鈕)。
 */
export const TransferPrintButtons = ({
  receipts,
}: {
  receipts: Pick<
    ReturnType<typeof useTransferReceipts>,
    "shipment" | "payment"
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
