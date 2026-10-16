import { useApplyCenterCountsQuery } from "@repo/graphql";

import type { RealtimeSignalRegistration } from "@/lib/base/realtime/signal-registry";

/**
 * 底座的信號類型登記(組裝在 `app/module-pages.tsx`)。
 * `badge:apply-center`:流程任務建立 / 結束 / 改派時 api 對相關審核者送出 → 重抓申請中心計數(側欄只顯示待我審核)。
 */
export const baseRealtimeSignals: readonly RealtimeSignalRegistration[] = [
  {
    type: "badge:apply-center",
    queryKeys: [useApplyCenterCountsQuery.getKey()],
  },
];
