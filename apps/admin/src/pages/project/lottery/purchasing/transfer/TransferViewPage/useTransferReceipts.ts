import { transferHeaderOf } from "@repo/domain/project/lottery";
import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  type LotterySettlementFieldsFragment,
  type LotteryTransferReceivingFieldsFragment,
} from "@repo/graphql";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { latestTransferPaymentInputOf } from "@/lib/project/lottery/receipts/transfer-payment-receipt";
import {
  type TransferReceivingReceiptInput,
  transferReceivingInputOf,
} from "@/lib/project/lottery/receipts/transfer-receiving-receipt";
import { transferShipmentInputOf } from "@/lib/project/lottery/receipts/transfer-shipment-receipt";

import { TRANSFER_MODULE_KEY } from "../transfer-keys";

/**
 * 調貨單檢視頁標頭 [列印] 的資料(規格第 12 章):
 * - `shipment`:調貨出貨單 —— 出貨之前印整張(出貨確認時核對),出貨之後印已出貨的列
 * - `receiving`:調貨點收單 —— 每一次點收([完成這次點收] 的點收批次)一張;`inputOf(batch)` 排那一次的資料,
 *   [完成這次點收] 後的自動列印也用它;還沒載到 → null
 * - `payment`:最近一筆收貨店付的現金(調貨付款收據的 [列印] / [補印]);沒有 → null
 *
 * 第一關通過後的自動列印不在這裡:登記成調貨單的審核擴充(`TransferShipmentEffect`),任何畫面通過第一關都會印。
 * 草稿不印(還沒送出)。
 */
export const useTransferReceipts = (
  /** 調貨單(提交)id */
  id: string,
  submission: FormSubmissionFieldsFragment | null,
  /** 點收區塊的資料(還沒載到 → null) */
  data: LotteryTransferReceivingFieldsFragment | null,
  settlement: LotterySettlementFieldsFragment | null,
) => {
  const { viewRoute } = useFormModuleAccess(TRANSFER_MODULE_KEY);
  const url = `${globalThis.location.origin}${viewRoute ?? ""}/${id}`;
  const receiving =
    submission === null || submission.status === FormSubmissionStatus.Draft
      ? null
      : data;
  const rows = receiving?.rows ?? [];
  const shippedRows = rows.filter((row) => row.shipped);
  const printedRows = shippedRows.length > 0 ? shippedRows : rows;
  const shipment =
    receiving === null || submission === null || rows.length === 0
      ? null
      : transferShipmentInputOf(
          receiving,
          {
            submissionId: id,
            serialNo: submission.serialNo ?? null,
            fromBranchId:
              transferHeaderOf(submission.values).fromBranchId ?? "",
            url,
          },
          printedRows,
        );
  const payment =
    settlement === null ? null : latestTransferPaymentInputOf(settlement, url);
  /** 調貨點收單的資料:`latest` = 這次要印的點收區塊(完成點收後用 api 回的那一份);還沒載到調貨單 → null */
  const receivingInputOf =
    submission === null
      ? null
      : (
          latest: LotteryTransferReceivingFieldsFragment,
          batch: TransferReceivingReceiptInput["batch"],
        ): TransferReceivingReceiptInput =>
          transferReceivingInputOf(
            latest,
            {
              submissionId: id,
              serialNo: submission.serialNo ?? null,
              toBranchId: transferHeaderOf(submission.values).toBranchId ?? "",
              url,
            },
            batch,
          );
  const receivingReceipt =
    receiving === null || receivingInputOf === null
      ? null
      : {
          batches: receiving.batches,
          receivedCount: receiving.receivedCount,
          inputOf: (batch: TransferReceivingReceiptInput["batch"]) =>
            receivingInputOf(receiving, batch),
        };

  return { shipment, receiving: receivingReceipt, receivingInputOf, payment };
};
