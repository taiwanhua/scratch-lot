import { useCallback } from "react";

import type { LotterySettlementFieldsFragment } from "@repo/graphql";

import { FORM_MODULE_PAGE_SUFFIXES } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { transferPaymentInputOf } from "@/lib/project/lottery/receipts/transfer-payment-receipt";

/**
 * 付款視窗寫入成功之後的列印(規格第 12 章「調貨付款收據:收貨店付現金時自動」):
 * 這筆是調貨單收貨店付的現金才印,其他(銀行、出貨店、收到退款、進貨單)不印。
 * 結算區塊與待結清款項分頁共用;`host` 要放進畫面(付款視窗關掉之後才轉圖)。
 */
export const useSettlementReceipt = () => {
  const { printReceiptAfterCommit, host } = useReceiptPrinter();
  const routeOf = useModuleRoutes();
  const onRecorded = useCallback(
    (recordId: string, item: LotterySettlementFieldsFragment) => {
      const viewRoute = routeOf(
        `${item.moduleKey}.${FORM_MODULE_PAGE_SUFFIXES.viewPage}`,
      );
      const url = `${globalThis.location.origin}${viewRoute ?? ""}/${item.refId}`;
      const input = transferPaymentInputOf(item, recordId, url);
      if (input !== null) {
        void printReceiptAfterCommit("transfer-payment", input);
      }
    },
    [printReceiptAfterCommit, routeOf],
  );
  return { onRecorded, host };
};
