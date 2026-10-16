import type { QueryKey } from "@tanstack/react-query";

/**
 * 信號類型登記(底座規格第 4 章「頻道」):每種信號對應要 invalidate 的 TanStack Query key。
 * 收到信號、斷線時的 60 秒輪詢、重新連線後的補抓,都 invalidate 這裡登記的 key(只重抓畫面上有在用的)。
 * 頁面要做額外的事(例:看板重排)用 `useRealtimeSignal(type, handler)`。
 */
export interface RealtimeSignalRegistration {
  /** 信號類型,如 `badge:apply-center`、`notification`。 */
  type: string;
  queryKeys: readonly QueryKey[];
}

export type RealtimeSignalTable = ReadonlyMap<string, readonly QueryKey[]>;

/** 合併底座與專案的登記;同一類型登記兩次 → 載入就丟錯,不悄悄蓋掉。 */
export const composeRealtimeSignals = (
  base: readonly RealtimeSignalRegistration[],
  project: readonly RealtimeSignalRegistration[],
): RealtimeSignalTable => {
  const table = new Map<string, readonly QueryKey[]>();
  for (const entry of [...base, ...project]) {
    if (table.has(entry.type)) {
      throw new Error(`即時信號類型重複登記:${entry.type}`);
    }
    table.set(entry.type, entry.queryKeys);
  }
  return table;
};
