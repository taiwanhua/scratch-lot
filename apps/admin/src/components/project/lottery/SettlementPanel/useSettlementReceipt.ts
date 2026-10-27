import { useCallback } from "react";

import type { LotterySettlementFieldsFragment } from "@repo/graphql";

import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { logReceiptPrintFailure } from "@/lib/project/lottery/receipts/receipt-log";
import { transferPaymentInputOf } from "@/lib/project/lottery/receipts/transfer-payment-receipt";

/**
 * 付款視窗寫入成功之後的列印(規格第 12 章「調貨付款收據:收貨店付現金時自動」):
 * 這筆是調貨單收貨店付的現金才印,其他(銀行、出貨店、收到退款、進貨單)不印。
 * 結算區塊與待結清款項分頁共用;`host` 要放進畫面(付款視窗關掉之後才轉圖)。
 */
export const useSettlementReceipt = () => {
  const { printReceiptAfterCommit, host } = useReceiptPrinter();
  // QR 的路由依模組樹(`lotteryReceiptLinks`),不依付款的人的權限
  const { fetchLinks } = useReceiptLinks();
  const onRecorded = useCallback(
    (recordId: string, item: LotterySettlementFieldsFragment) => {
      const print = async () => {
        const { transferViewUrl } = await fetchLinks();
        const input = transferPaymentInputOf(
          item,
          recordId,
          transferViewUrl(item.refId),
        );
        if (input !== null) {
          await printReceiptAfterCommit("transfer-payment", input);
        }
      };
      print().catch((error: unknown) => {
        logReceiptPrintFailure("print failed", {
          kind: "transfer-payment",
          error,
        });
      });
    },
    [fetchLinks, printReceiptAfterCommit],
  );
  return { onRecorded, host };
};
