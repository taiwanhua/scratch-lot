import { useTranslations } from "use-intl";

import {
  OPENING_STOCK,
  type OpeningCard,
  type OpeningCardPlan,
  type OpeningPlace,
} from "./opening-plan";

/**
 * 本卡與確認框的合計(規格 3.1):「迄號 101:導入前已賣出 46 · 跳號 1 · 在手上 54(檯面 A 54)」;
 * 位置依分到的張數列出(檯面 {收銀點} N / 庫存 N)。
 */
export const useOpeningSummary = (places: readonly OpeningPlace[]) => {
  const t = useTranslations("admin.lotteryInventory.opening.card");
  return (card: OpeningCard, plan: OpeningCardPlan): string => {
    const parts = plan.assignments
      .filter((row) => row.ticketNos.length > 0)
      .map((row) =>
        row.cashPointId === OPENING_STOCK
          ? t("placeStock", { count: row.ticketNos.length })
          : t("placeCounter", {
              name:
                places.find((place) => place.id === row.cashPointId)?.name ??
                "",
              count: row.ticketNos.length,
            }),
      );
    return t("summary", {
      last: plan.last ?? card.lastText,
      sold: card.sold.length,
      skipped: card.skipped.length,
      inHand: plan.inHand.length,
      places: parts.join(" · "),
    });
  };
};
