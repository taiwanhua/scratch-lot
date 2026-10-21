import type { CashPointHeaderAction } from "@/components/project/lottery/CashPointHeader/CashPointHeader";

import type { RedemptionFlow } from "./useRedemptionFlow";

export interface RedemptionBoardActionsInput {
  orgId: string;
  cashPointName: string;
  shift: { id: string; isMine: boolean; expectedCash: number };
  /** 有 `store.redeem` */
  canRedeem: boolean;
  labels: { redeem: string; recent: string };
  flow: RedemptionFlow;
}

/**
 * 本機收銀點、開班中的標題列上兌獎的按鈕(規格 6.2;Spec #104 第 3 節第 9 批:P23 追加 [兌獎] [最近兌獎]):
 * [兌獎] 要 `store.redeem`(`leading`:按鈕列最前面);[最近兌獎] 只在自己開的那一班(`trailing`:文字按鈕,接在 [最近售出] 後面)。
 */
export const redemptionBoardActions = ({
  orgId,
  cashPointName,
  shift,
  canRedeem,
  labels,
  flow,
}: RedemptionBoardActionsInput): {
  leading: CashPointHeaderAction[];
  trailing: CashPointHeaderAction[];
} => ({
  leading: canRedeem
    ? [
        {
          key: "redeem",
          label: labels.redeem,
          onClick: () => {
            flow.openRedeem({
              orgId,
              shiftId: shift.id,
              cashPointName,
              expectedCash: shift.expectedCash,
            });
          },
        },
      ]
    : [],
  trailing: shift.isMine
    ? [
        {
          key: "recent-redemptions",
          label: labels.recent,
          emphasis: "link",
          onClick: () => {
            flow.openRecent({ shiftId: shift.id, cashPointName });
          },
        },
      ]
    : [],
});
