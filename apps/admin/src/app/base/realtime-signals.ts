import {
  useApplyCenterCountsQuery,
  useSidebarBadgesQuery,
} from "@repo/graphql";

import type { RealtimeSignalRegistration } from "@/lib/base/realtime/signal-registry";

/**
 * 底座的信號類型登記(組裝在 `app/module-pages.tsx`)。
 * - `badge:*`:任何模組的側欄計數有變(api `publishBadge`)→ 重抓 `sidebarBadges`(側欄登記制,底座規格 10.4);
 *   專案新增側欄計數只要在 api `registerBadge` 並送 `badge:<模組 key>`,這裡不必再登記。
 * - `badge:apply-center`:流程任務建立 / 結束 / 改派時 api 對相關審核者送出 → 另外重抓申請中心頁籤的計數
 *   (`applyCenterCounts`;側欄那一筆由 `badge:*` 涵蓋)。
 */
export const baseRealtimeSignals: readonly RealtimeSignalRegistration[] = [
  {
    type: "badge:*",
    queryKeys: [useSidebarBadgesQuery.getKey()],
  },
  {
    type: "badge:apply-center",
    queryKeys: [useApplyCenterCountsQuery.getKey()],
  },
];
