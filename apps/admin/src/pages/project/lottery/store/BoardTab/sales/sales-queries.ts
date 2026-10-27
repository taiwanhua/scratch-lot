import { type QueryKey, useQueryClient } from "@tanstack/react-query";

import { STORE_BOARD_QUERY_KEY } from "../board-query";

/** 展開卡片的格子(`useLotteryStoreBookCardQuery`;即時信號 `board` 也重抓,`app/project/realtime-signals.ts`)。 */
export const STORE_BOOK_CARD_QUERY_KEY: QueryKey = ["LotteryStoreBookCard"];

/** [最近售出] 清單(`useLotteryStoreRecentSalesQuery`)。 */
export const STORE_RECENT_SALES_QUERY_KEY: QueryKey = [
  "LotteryStoreRecentSales",
];

/** 售出、撤銷、拆本、移櫃之後要重抓的資料(看板、展開卡片、最近售出、撤銷確認、拆本選本)。 */
const SALES_REFRESH_KEYS: readonly QueryKey[] = [
  STORE_BOARD_QUERY_KEY,
  STORE_BOOK_CARD_QUERY_KEY,
  STORE_RECENT_SALES_QUERY_KEY,
  ["LotteryStoreSale"],
  ["LotteryStoreStockBooks"],
];

export const useRefreshSales = () => {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of SALES_REFRESH_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
};
