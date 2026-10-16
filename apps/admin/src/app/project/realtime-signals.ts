import type { RealtimeSignalRegistration } from "@/lib/base/realtime/signal-registry";

/**
 * 專案的信號類型登記(組裝在 `app/module-pages.tsx`;類型不可與底座重複)。
 *
 * ```ts
 * { type: "badge:dealers", queryKeys: [useDealerOverdueCountQuery.getKey()] }
 * ```
 */
export const projectRealtimeSignals: readonly RealtimeSignalRegistration[] = [];
