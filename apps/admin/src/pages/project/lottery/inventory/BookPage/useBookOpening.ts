import { useTranslations } from "use-intl";

import {
  type LotteryInventoryBookDetailFieldsFragment,
  useLotteryStoreOpeningQuery,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import type { OpeningCells, SelectionActions } from "./book-cells";

/**
 * 本的詳情的期初建檔部分(期初建檔規格 4.1、5.3):導入前已賣出的格子(已售樣式、提示、能期初更正才可選)、
 * 圖例「已售(含導入前已賣出)」、操作列的 [改回未售…] / [改成導入前已賣出…](後者要分店還在建檔)、
 * 不是期初建檔的本、沒有 `inventory.opening` → 不讀分店狀態。
 */
export const useBookOpening = (
  detail: LotteryInventoryBookDetailFieldsFragment | null,
) => {
  const t = useTranslations("admin.lotteryInventory.book");
  const { session } = useSession();
  const canFix = detail?.abilities.canFixOpening === true;
  const opening = useLotteryStoreOpeningQuery(
    session.client,
    { orgId: detail?.book.org.id ?? "" },
    { enabled: canFix, retry: false },
  ).data?.lotteryStoreOpening.item;
  const cells: OpeningCells = {
    tooltip: t("openingSoldTooltip"),
    selectable: canFix,
  };
  const hasOpeningSold =
    detail?.tickets.some((ticket) => ticket.openingSold) === true;
  return {
    cells,
    gridLabels: hasOpeningSold
      ? { labels: { sold: t("soldWithOpening") } }
      : {},
    actionsOf: (actions: SelectionActions) => ({
      canFixToUnsold: canFix && actions.canFixToUnsold,
      canFixToOpeningSold:
        canFix && opening?.canOpen === true && actions.canFixToOpeningSold,
    }),
  };
};
