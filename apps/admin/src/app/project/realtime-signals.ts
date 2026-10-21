import { STORE_BOARD_SIGNAL } from "@repo/domain/project/lottery";

import type { RealtimeSignalRegistration } from "@/lib/base/realtime/signal-registry";
import { STORE_BOARD_QUERY_KEY } from "@/pages/project/lottery/store/BoardTab/board-query";
import {
  STORE_BOOK_CARD_QUERY_KEY,
  STORE_RECENT_SALES_QUERY_KEY,
} from "@/pages/project/lottery/store/BoardTab/sales/sales-queries";

/**
 * 專案的信號類型登記(組裝在 `app/module-pages.tsx`;類型不可與底座重複)。
 * 側欄計數不必登記:底座的 `badge:*` 已涵蓋所有 `badge:<模組 key>`(重抓 `sidebarBadges`);
 * 只有頁面上另有要跟著重抓的資料時才登記那個類型:
 *
 * ```ts
 * { type: "badge:dealers", queryKeys: [useDealerOverdueListQuery.getKey()] }
 * ```
 */
export const projectRealtimeSignals: readonly RealtimeSignalRegistration[] = [
  // 店面管理的看板(`board:<分店>` 頻道,規格 6.1):重抓看板、展開的卡片與 [最近售出]
  {
    type: STORE_BOARD_SIGNAL,
    queryKeys: [
      STORE_BOARD_QUERY_KEY,
      STORE_BOOK_CARD_QUERY_KEY,
      STORE_RECENT_SALES_QUERY_KEY,
    ],
  },
];
