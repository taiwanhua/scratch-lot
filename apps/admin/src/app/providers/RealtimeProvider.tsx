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
  type RealtimeBoard,
  RealtimeConnection,
  type RealtimeConnectionOptions,
  type RealtimeStatus,
  browserTimers,
} from "@/lib/base/realtime/realtime-connection";
import type { RealtimeSignalTable } from "@/lib/base/realtime/signal-registry";

/** 斷線(慢速模式)時多久輪詢一次登記的資料(毫秒)。 */
export const REALTIME_POLL_INTERVAL_MS = 60_000;
/**
 * 收到信號後多久再重抓一次同一批資料(毫秒):送出端對看板信號「前緣送、2 秒窗內丟棄」,
 * 窗內最後一次變動靠這次補上(其他類型多抓一次無害)。
 */
export const REALTIME_FOLLOW_UP_MS = 2500;

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
  const followUps = useRef(new Set<string>());

  const invalidateAll = useCallback(() => {
    for (const keys of signals.values()) {
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  }, [queryClient, signals]);

  useEffect(() => {
    const timers = injected.current?.timers ?? browserTimers;
    const instance = new RealtimeConnection({
      fetchTicket: async (board) => {
        const data = await useRealtimeTicketQuery.fetcher(session.client, {
          board,
        })();
        return data.realtimeTicket ?? null;
      },
      ...injected.current,
      onStatus: setStatus,
      onCatchUp: invalidateAll,
      onSignal: (signal, topic) => {
        const keys = signals.get(signal.type) ?? [];
        for (const queryKey of keys) {
          void queryClient.invalidateQueries({ queryKey });
        }
        // 約 2.5 秒後再抓一次(同一類型排一次就好),補上送出端在 2 秒窗內丟掉的變動
        if (keys.length > 0 && !followUps.current.has(signal.type)) {
          followUps.current.add(signal.type);
          timers.set(() => {
            followUps.current.delete(signal.type);
            for (const queryKey of keys) {
              void queryClient.invalidateQueries({ queryKey });
            }
          }, REALTIME_FOLLOW_UP_MS);
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

  const setBoard = useCallback((board: RealtimeBoard | null) => {
    connection.current?.setBoard(board);
  }, []);

  const refresh = useCallback(() => {
    connection.current?.refresh();
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({ status, listen, setBoard, refresh }),
    [status, listen, setBoard, refresh],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
};
