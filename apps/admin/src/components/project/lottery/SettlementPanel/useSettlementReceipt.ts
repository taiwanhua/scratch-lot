import { useCallback } from "react";

import type { LotterySettlementFieldsFragment } from "@repo/graphql";

import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { logPrintFailure } from "@/lib/base/print-log";
import { transferPaymentInputOf } from "@/lib/project/lottery/receipts/transfer-payment-receipt";
import { wholesalePaymentInputOf } from "@/lib/project/lottery/receipts/wholesale-payment-receipt";

/**
 * 付款 / 收款視窗寫入成功之後的列印(規格第 12 章、21.8):
 * - 調貨單收貨店付的現金 → 調貨付款收據
 * - 批售單出貨店收的現金([收款] 選現金)→ 批售收款收據
 *
 * 其他(銀行、退款、出貨店收到調貨款、進貨單)不印。結算區塊與待結清款項分頁共用;`host` 要放進畫面(視窗關掉之後才轉圖)。
 */
export const useSettlementReceipt = () => {
  const { printReceiptAfterCommit, host } = useReceiptPrinter();
  // QR 的路由依模組樹(`lotteryReceiptLinks`),不依付款的人的權限
  const { fetchLinks } = useReceiptLinks();
  const onRecorded = useCallback(
    (recordId: string, item: LotterySettlementFieldsFragment) => {
      const kind =
        item.kind === "wholesale" ? "wholesale-payment" : "transfer-payment";
      const print = async () => {
        const links = await fetchLinks();
        if (item.kind === "wholesale") {
          const input = wholesalePaymentInputOf(
            item,
            recordId,
            links.wholesaleViewUrl(item.refId),
          );
          if (input !== null) {
            await printReceiptAfterCommit("wholesale-payment", input);
          }
          return;
        }
        const input = transferPaymentInputOf(
          item,
          recordId,
          links.transferViewUrl(item.refId),
        );
        if (input !== null) {
          await printReceiptAfterCommit("transfer-payment", input);
        }
      };
      print().catch((error: unknown) => {
        logPrintFailure("print failed", { kind, error });
      });
    },
    [fetchLinks, printReceiptAfterCommit],
  );
  return { onRecorded, host };
};
