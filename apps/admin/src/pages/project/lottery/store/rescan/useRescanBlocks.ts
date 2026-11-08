import { useLotteryStocktakeStatusQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import {
  type RescanBrief,
  type RescanReminder,
  rescanBlockOf,
  rescanningPlacesOf,
} from "./rescan-model";

export interface RescanBlocks {
  rescans: readonly RescanBrief[];
  reminders: readonly RescanReminder[];
  /** 這一組(收銀點 × 遊戲)正在重刷、不能數(8.5a B5) */
  isGroupBlocked: (cashPointId: string, gameId: string) => boolean;
  /** 庫存那一區這個遊戲正在重刷(依遊戲代號;庫存的本只有代號) */
  isStockBlocked: (gameCode: string) => boolean;
  /** 正在重刷的位置 × 遊戲(盤點頁頂部的提示) */
  rescanning: ReturnType<typeof rescanningPlacesOf>;
}

/**
 * 盤點頁的全店重刷(張數店規格 8.5a B5、8.3;Figma CS-09b):讀 `lotteryStocktakeStatus` 的進行中重刷與提醒
 * (看板信號重抓),算出哪一組正在重刷(已開始刷、還沒按刷完)→ 那一組變灰、不能輸入;後端送出時再擋。
 */
export const useRescanBlocks = (orgId: string): RescanBlocks => {
  const { session } = useSession();
  const status = useLotteryStocktakeStatusQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const rescans = status.data?.lotteryStocktakeStatus.rescans ?? [];
  const reminders = status.data?.lotteryStocktakeStatus.rescanReminders ?? [];
  const blocked = rescanBlockOf(rescans);
  const rescanning = rescanningPlacesOf(rescans);
  return {
    rescans,
    reminders,
    isGroupBlocked: (cashPointId, gameId) => blocked(cashPointId, gameId),
    isStockBlocked: (gameCode) =>
      rescanning.some(
        ({ rescan, place }) =>
          place.cashPointId == null && rescan.gameCode === gameCode,
      ),
    rescanning,
  };
};
