import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useLotteryTransferReceivingQuery } from "@repo/graphql";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { useSession } from "@/hooks/base/useSession";
import { transferShipmentInputOf } from "@/lib/project/lottery/receipts/transfer-shipment-receipt";

import { TRANSFER_MODULE_KEY } from "./transfer-keys";

/** 出貨單要的單據識別(列印紀錄的 `refId`、單號、出貨分店)。 */
export interface ShipmentDocument {
  submissionId: string;
  serialNo: string | null;
  fromBranchId: string;
}

/**
 * 調貨出貨單的自動列印(規格第 12 章「第一關通過後(含跳過)」),新增頁與檢視頁共用:
 * 寫入成功(送出、審核決定)之後重抓點收區塊,這次才變「在途」的列 = 第一關通過時調出的列 → 印出貨單。
 * 寫入失敗的呼叫端不會叫到這裡(交易失敗不印);沒有新調出的列(第一關還沒過、駁回、退回)不印。
 * `host` 要放進畫面(轉圖用)。
 */
export const useShipmentReceipt = () => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { canPrint, printReceiptAfterCommit, host } = useReceiptPrinter();
  const { viewRoute } = useFormModuleAccess(TRANSFER_MODULE_KEY);
  const urlOf = useCallback(
    (submissionId: string) =>
      `${globalThis.location.origin}${viewRoute ?? ""}/${submissionId}`,
    [viewRoute],
  );

  const printNewlyShipped = useCallback(
    async (
      document: ShipmentDocument,
      shippedBefore: ReadonlySet<string>,
    ): Promise<void> => {
      const { submissionId } = document;
      if (!canPrint) {
        return;
      }
      try {
        const fresh = await queryClient.fetchQuery({
          queryKey: useLotteryTransferReceivingQuery.getKey({ submissionId }),
          queryFn: useLotteryTransferReceivingQuery.fetcher(session.client, {
            submissionId,
          }),
        });
        const receiving = fresh.lotteryTransferReceiving;
        const shipped = receiving.rows.filter(
          (row) => row.shipped && !shippedBefore.has(row.rowId),
        );
        if (shipped.length > 0) {
          await printReceiptAfterCommit(
            "transfer-shipment",
            transferShipmentInputOf(
              receiving,
              { ...document, url: urlOf(submissionId) },
              shipped,
            ),
          );
        }
      } catch {
        // 重抓失敗:畫面照常(列印是交易後的附帶動作,失敗不打斷)
      }
    },
    [canPrint, printReceiptAfterCommit, queryClient, session.client, urlOf],
  );

  return { printNewlyShipped, urlOf, host };
};
