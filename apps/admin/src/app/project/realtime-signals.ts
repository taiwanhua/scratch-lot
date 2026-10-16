import type { RealtimeSignalRegistration } from "@/lib/base/realtime/signal-registry";

/**
 * 專案的信號類型登記(組裝在 `app/module-pages.tsx`;類型不可與底座重複)。
 * 側欄計數不必登記:底座的 `badge:*` 已涵蓋所有 `badge:<模組 key>`(重抓 `sidebarBadges`);
 * 只有頁面上另有要跟著重抓的資料時才登記那個類型:
 *
 * ```ts
 * { type: "badge:dealers", queryKeys: [useDealerOverdueListQuery.getKey()] }
 * ```
 */
export const projectRealtimeSignals: readonly RealtimeSignalRegistration[] = [];
