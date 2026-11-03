import { useState } from "react";

import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  type LotteryStoreShiftOptionFieldsFragment,
} from "@repo/graphql";

import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { logPrintFailure } from "@/lib/base/print-log";

import {
  type ReversalCountRow,
  type ReversalGroup,
  refundAmountOf,
} from "../sale-reversal-form";

export interface SaleRefundPrintInput {
  submitted: FormSubmissionFieldsFragment;
  orgId: string;
  refundShift: LotteryStoreShiftOptionFieldsFragment | null;
  reasonLabel: string;
  groups: readonly ReversalGroup[];
  /** 依遊戲 + 張數的列(帶遊戲代號與名稱) */
  countRows: readonly ReversalCountRow[];
}

/**
 * 撤銷售出申請新增頁的退貨退款收據(規格第 12 章):送出成功後印(還在審核標「待核准」)。
 * 轉圖節點(`host`)在新增頁,印完(成功或失敗只記 log)才離開;印的期間 `isPrinting`(按鈕維持停用)。
 * 印表機 = 退款班次所屬收銀點的印表機,沒設定 → 分店預設(規格 5.5)。
 */
export const useSaleRefundPrint = () => {
  const { canPrint, printReceiptAfterCommit, host } = useReceiptPrinter();
  const { fetchLinks } = useReceiptLinks();
  const [isPrinting, setIsPrinting] = useState(false);

  const print = async ({
    submitted,
    orgId,
    refundShift,
    reasonLabel,
    groups,
    countRows,
  }: SaleRefundPrintInput): Promise<void> => {
    setIsPrinting(true);
    try {
      const links = await fetchLinks();
      await printReceiptAfterCommit("store-sale-refund", {
        submissionId: submitted.id,
        serialNo: submitted.serialNo ?? null,
        branchId: orgId,
        pending: submitted.status !== FormSubmissionStatus.Completed,
        refundShiftLabel: refundShift?.label ?? "",
        defaultPrinterId: refundShift?.cashPointPrinterId ?? null,
        reasonLabel,
        groups: [
          ...groups.flatMap((group) => {
            const ticketNos = [...group.ticketNos, ...group.matchNos].toSorted(
              (left, right) => left.localeCompare(right),
            );
            return ticketNos.length === 0
              ? []
              : [
                  {
                    gameCode: group.gameCode,
                    gameName: group.gameName,
                    ticketNos,
                    amount: group.unitPrice * ticketNos.length,
                  },
                ];
          }),
          ...countRows.map((row) => ({
            gameCode: row.gameCode,
            gameName: row.gameName,
            ticketNos: [],
            count: row.count,
            amount: row.unitPrice * row.count,
          })),
        ],
        refundAmount: refundAmountOf(groups, countRows),
        url: links.storeViewUrl(submitted.id),
      });
    } catch (error) {
      // 列印出錯只記 log(讀不到 QR 的路由不會到這裡,`fetchLinks` 照印、不印 QR)
      logPrintFailure("print failed", {
        kind: "store-sale-refund",
        error,
      });
    }
  };

  return { canPrint, isPrinting, print, host };
};
