import { type QueryKey, useQueryClient } from "@tanstack/react-query";

import { STORE_CHECKOUT_WIZARD_QUERY_KEY } from "../checkout/checkout-keys";
import { STORE_DAILY_CLOSE_WIZARD_QUERY_KEY } from "../daily-close/daily-close-keys";

/**
 * 盤點的 query key 前綴:看板信號 `board`(`app/project/realtime-signals.ts`)一起重抓 ——
 * 盤點頁的各收銀點應有現金(補登兌獎、看板售出之後)、看板頂部的「建議盤點一次」、盤點紀錄分頁。
 */
export const STOCKTAKE_QUERY_KEYS: readonly QueryKey[] = [
  ["LotteryStocktakeSheet"],
  ["LotteryStocktakeStatus"],
  ["LotteryStocktakes"],
];

/**
 * [補登售出] / [算售出] 立即生效,交班、日結精靈的應有現金要跟著變:自己重抓,不只靠 `board` 信號
 * (即時連線斷線或沒開時信號到不了,精靈會停在舊金額,抽屜那一步的差額就錯了)。
 */
export const useRefreshWizardCash = () => {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of [
      STORE_CHECKOUT_WIZARD_QUERY_KEY,
      STORE_DAILY_CLOSE_WIZARD_QUERY_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
};
