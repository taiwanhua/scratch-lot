import type { CashPointHeaderAction } from "@/components/project/lottery/CashPointHeader/CashPointHeader";

import type { BoardCashPoint } from "../CashPointSection";
import type { SalesDialog } from "./SalesBoardDialogs";

/**
 * 收銀點標題列的 [依張數標記售出](張數店規格 7.2、13.1;Figma CS-01a):只有張數店(轉換中不顯示,9.2)、
 * 本機收銀點自己開的班、有 `store.sell`、這台有未售的遊戲;按下開依張數標記售出視窗(遊戲取自遊戲合計)。
 */
export const countSaleActionsOf = ({
  point,
  countMode,
  canSell,
  label,
  shiftText,
  open,
}: {
  point: BoardCashPoint;
  countMode: string;
  canSell: boolean;
  label: string;
  /** 「負責人 王小明 · 08:02 開班 · 這一班的錢」 */
  shiftText: string;
  open: (dialog: SalesDialog) => void;
}): CashPointHeaderAction[] => {
  if (
    countMode !== "count" ||
    point.shift?.isMine !== true ||
    !canSell ||
    point.gameTotals.length === 0
  ) {
    return [];
  }
  const priceOf = (gameId: string) =>
    point.books.find((book) => book.gameId === gameId)?.unitPrice ?? 0;
  return [
    {
      key: "count-sale",
      label,
      onClick: () => {
        open({
          kind: "countSale",
          cashPointId: point.id,
          cashPointName: point.name,
          shiftText,
          games: point.gameTotals.map((total) => ({
            gameId: total.gameId,
            gameCode: total.gameCode,
            gameName: total.gameName,
            remaining: total.remaining,
            unitPrice: priceOf(total.gameId),
          })),
        });
      },
    },
  ];
};
