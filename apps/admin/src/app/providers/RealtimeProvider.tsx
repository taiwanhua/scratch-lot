import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useRealtimeTicketQuery } from "@repo/graphql";

import {
  RealtimeContext,
  type RealtimeContextValue,
  type RealtimeSignalHandler,
} from "@/hooks/base/useRealtime";
import { useSession } from "@/hooks/base/useSession";
import {
  RealtimeConnection,
  type RealtimeConnectionOptions,
  type RealtimeStatus,
  browserTimers,
} from "@/lib/base/realtime/realtime-connection";
import type { RealtimeSignalTable } from "@/lib/base/realtime/signal-registry";

/** 斷線(慢速模式)時多久輪詢一次登記的資料(毫秒)。 */
export const REALTIME_POLL_INTERVAL_MS = 60_000;

export interface RealtimeProviderProps {
  /** 信號類型登記表(`app/module-pages.tsx` 的 `realtimeSignals`)。 */
  signals: RealtimeSignalTable;
  /** 測試注入假的 WebSocket / 計時器 / 拿憑證。 */
  connectionOptions?: Partial<
    Pick<RealtimeConnectionOptions, "createSocket" | "timers" | "fetchTicket">
  >;
  children: ReactNode;
}

/**
 * 即時通道(殼層;底座規格第 4 章):登入後建立連線、到期前 1 分鐘在原連線換發、重連退避、
 * 看板頁換發;收到信號 → invalidate 登記表對應的 query key 並通知 `useRealtimeSignal`。
 *
 * **降級**:不是 `live` 的期間(連不上、Worker 關掉、即時通道停用)每 60 秒 invalidate 登記表全部 key;
 * 重新連上後先補抓一次(同樣 invalidate 全部),之後停止輪詢、只靠信號。invalidate 只重抓畫面上有在用的 query。
 */
export const RealtimeProvider = ({
  signals,
  connectionOptions,
  children,
}: RealtimeProviderProps) => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const listeners = useRef(new Map<string, Set<RealtimeSignalHandler>>());
  const connection = useRef<RealtimeConnection | null>(null);
  const injected = useRef(connectionOptions);

  const invalidateAll = useCallback(() => {
    for (const keys of signals.values()) {
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  }, [queryClient, signals]);

  useEffect(() => {
    const instance = new RealtimeConnection({
      fetchTicket: async (boardOrgId) => {
        const data = await useRealtimeTicketQuery.fetcher(session.client, {
          boardOrgId,
        })();
        return data.realtimeTicket ?? null;
      },
      ...injected.current,
      onStatus: setStatus,
      onCatchUp: invalidateAll,
      onSignal: (signal, topic) => {
        for (const queryKey of signals.get(signal.type) ?? []) {
          void queryClient.invalidateQueries({ queryKey });
        }
        for (const handler of listeners.current.get(signal.type) ?? []) {
          handler(signal, topic);
        }
      },
    });
    connection.current = instance;
    instance.start();
    return () => {
      instance.stop();
      connection.current = null;
    };
  }, [session.client, queryClient, signals, invalidateAll]);

  // 慢速模式:每 60 秒輪詢一次;回到 live 就停
  useEffect(() => {
    if (status === "live") {
      return;
    }
    const timers = injected.current?.timers ?? browserTimers;
    let handle: unknown = null;
    const tick = () => {
      invalidateAll();
      handle = timers.set(tick, REALTIME_POLL_INTERVAL_MS);
    };
    handle = timers.set(tick, REALTIME_POLL_INTERVAL_MS);
    return () => {
      timers.clear(handle);
    };
  }, [status, invalidateAll]);

  const listen = useCallback((type: string, handler: RealtimeSignalHandler) => {
    const set = listeners.current.get(type) ?? new Set();
    set.add(handler);
    listeners.current.set(type, set);
    return () => {
      set.delete(handler);
    };
  }, []);

  const setBoard = useCallback((orgId: string | null) => {
    connection.current?.setBoard(orgId);
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({ status, listen, setBoard }),
    [status, listen, setBoard],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
};
