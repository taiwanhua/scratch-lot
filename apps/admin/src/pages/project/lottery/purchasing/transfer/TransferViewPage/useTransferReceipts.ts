import { transferHeaderOf } from "@repo/domain/project/lottery";
import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  type LotterySettlementFieldsFragment,
  type LotteryTransferReceivingFieldsFragment,
} from "@repo/graphql";

import { latestTransferPaymentInputOf } from "@/lib/project/lottery/receipts/transfer-payment-receipt";
import { transferShipmentInputOf } from "@/lib/project/lottery/receipts/transfer-shipment-receipt";

import { useShipmentReceipt } from "../useShipmentReceipt";

/**
 * 調貨單檢視頁的列印(規格第 12 章):
 * - `shipment`:標頭 [列印] 的調貨出貨單 —— 出貨之前印整張(出貨確認時核對),出貨之後印已出貨的列
 * - `payment`:最近一筆收貨店付的現金(調貨付款收據的 [列印] / [補印]);沒有 → null
 * - `afterDecided`:在這頁做了審核決定之後,這次才調出的列印成調貨出貨單(`useShipmentReceipt`)
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
  const { printNewlyShipped, urlOf, host } = useShipmentReceipt();
  const receiving =
    submission === null || submission.status === FormSubmissionStatus.Draft
      ? null
      : data;
  const document = {
    submissionId: id,
    serialNo: submission?.serialNo ?? null,
    fromBranchId:
      submission === null
        ? ""
        : (transferHeaderOf(submission.values).fromBranchId ?? ""),
  };
  const rows = receiving?.rows ?? [];
  const shippedRows = rows.filter((row) => row.shipped);
  const printedRows = shippedRows.length > 0 ? shippedRows : rows;
  const shipment =
    receiving === null || rows.length === 0
      ? null
      : transferShipmentInputOf(
          receiving,
          { ...document, url: urlOf(id) },
          printedRows,
        );
  const payment =
    settlement === null
      ? null
      : latestTransferPaymentInputOf(settlement, urlOf(id));

  const afterDecided = () => {
    void printNewlyShipped(
      document,
      new Set(shippedRows.map((row) => row.rowId)),
    );
  };

  return { shipment, payment, afterDecided, host };
};
