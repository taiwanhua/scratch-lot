import type { QueryKey } from "@tanstack/react-query";

/**
 * 盤點的 query key 前綴:看板信號 `board`(`app/project/realtime-signals.ts`)一起重抓 ——
 * 盤點頁的各收銀點應有現金(補登兌獎、看板售出之後)、看板頂部的「建議盤點一次」、盤點紀錄分頁。
 */
export const STOCKTAKE_QUERY_KEYS: readonly QueryKey[] = [
  ["LotteryStocktakeSheet"],
  ["LotteryStocktakeStatus"],
  ["LotteryStocktakes"],
];
