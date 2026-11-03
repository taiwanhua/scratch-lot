import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";

import { RescanReminderAlerts } from "./RescanReminderAlerts";
import { useRescanBlocks } from "./useRescanBlocks";
import { useRescanStart } from "./useRescanStart";

export interface StocktakeRescan {
  /** 這一組(收銀點 × 遊戲)正在重刷、不能數 */
  groupBlocked: (group: { cashPointId: string; gameId: string }) => boolean;
  /** 庫存那一區的這本正在重刷、不能盤 */
  bookBlocked: (book: {
    cashPointId?: string | null;
    gameCode: string;
  }) => boolean;
  /** 頂部:「店外攤位 · 5164 發大財:這裡正在重刷 5164,刷完再數。」 */
  notices: ReactNode;
  /** 待查清單上方的全店重刷提醒([全店重刷 遊戲 X]) */
  reminders: ReactNode;
  /** 選中的組正在重刷 → 那個遊戲代號(組的面板寫「這裡正在重刷 X,刷完再數」);沒有 = null */
  groupCode: (group: {
    cashPointId: string;
    gameId: string;
    gameCode: string;
  }) => string | null;
  /** 選中的庫存的本正在重刷 → 提示(不顯示盤點的格子);沒有 = null */
  bookNotice: (
    book: { cashPointId?: string | null; gameCode: string } | undefined,
  ) => ReactNode;
  /** 開始全店重刷的確認視窗 */
  element: ReactNode;
}

/**
 * 盤點頁的全店重刷(張數店規格 8.5a B5、8.3;Figma CS-09b):正在重刷(已開始刷、還沒按刷完)的位置 × 遊戲那一組變灰、
 * 不能輸入(送出時後端再擋);頂部列出這些組;待查清單上方放重刷提醒。單一收銀點的盤點只看那台。
 */
export const useStocktakeRescan = (
  orgId: string,
  cashPoints: readonly { id: string; name: string }[],
  scopeCashPointId: string | null,
  stockName: string,
): StocktakeRescan => {
  const t = useTranslations("admin.lotteryStore.rescan.stocktake");
  const blocks = useRescanBlocks(orgId);
  const starter = useRescanStart(orgId, cashPoints);
  const rescanning = blocks.rescanning.filter(
    ({ place }) =>
      scopeCashPointId === null || place.cashPointId === scopeCashPointId,
  );
  return {
    groupBlocked: (group) =>
      blocks.isGroupBlocked(group.cashPointId, group.gameId),
    bookBlocked: (book) =>
      book.cashPointId == null && blocks.isStockBlocked(book.gameCode),
    notices: rescanning.map(({ rescan, place }) => (
      <Alert key={`${rescan.id}:${place.cashPointId ?? ""}`} severity="warning">
        {t("notice", {
          place: place.cashPointId == null ? stockName : place.name,
          game: `${rescan.gameCode} ${rescan.gameName}`,
          code: rescan.gameCode,
        })}
      </Alert>
    )),
    reminders: (
      <RescanReminderAlerts
        reminders={blocks.reminders}
        onStart={starter.open}
      />
    ),
    groupCode: (group) =>
      blocks.isGroupBlocked(group.cashPointId, group.gameId)
        ? group.gameCode
        : null,
    bookNotice: (book) =>
      book !== undefined &&
      book.cashPointId == null &&
      blocks.isStockBlocked(book.gameCode) ? (
        <Alert severity="warning">
          {t("blocked", { code: book.gameCode })}
        </Alert>
      ) : null,
    element: starter.element,
  };
};
