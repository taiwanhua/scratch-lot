import { createContext, useContext, useEffect, useRef } from "react";

import type { RealtimeSignal } from "@repo/domain/realtime";

import type {
  RealtimeBoard,
  RealtimeStatus,
} from "@/lib/base/realtime/realtime-connection";

export type RealtimeSignalHandler = (
  signal: RealtimeSignal,
  topic: string,
) => void;

/** 注入用 context(REACT-02):由 `app/providers/RealtimeProvider.tsx` 供給。 */
export interface RealtimeContextValue {
  status: RealtimeStatus;
  /** 收到某類型的信號時呼叫 handler;回傳取消函式。 */
  listen: (type: string, handler: RealtimeSignalHandler) => () => void;
  /** 看板頁打開哪個看板的哪家店(離開傳 null)。 */
  setBoard: (board: RealtimeBoard | null) => void;
  /** 立即換發訂閱憑證(切換目前組織後呼叫:跨租戶要換到新租戶的 Durable Object)。 */
  refresh: () => void;
}

export const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const useRealtimeContext = (): RealtimeContextValue => {
  const value = useContext(RealtimeContext);
  if (value === null) {
    throw new Error("useRealtime* must be used within <RealtimeProvider>");
  }
  return value;
};

/** 連線狀態(頭像選單的小圓點):`live` = 即時,其餘 = 重新連線中(慢速模式)。 */
export const useRealtimeStatus = (): RealtimeStatus =>
  useRealtimeContext().status;

/**
 * 收到某類型信號時做額外的事(登記表已負責 invalidate;這裡給看板之類要即時反應的頁面)。
 * handler 每次 render 換新也不會重新掛載。
 */
export const useRealtimeSignal = (
  type: string,
  handler: RealtimeSignalHandler,
): void => {
  const { listen } = useRealtimeContext();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(
    () =>
      listen(type, (signal, topic) => {
        latest.current(signal, topic);
      }),
    [listen, type],
  );
};

/** 切換目前組織等需要立即換發訂閱憑證的地方用。 */
export const useRealtimeRefresh = (): (() => void) =>
  useRealtimeContext().refresh;

/**
 * 看板頁:開著時在原連線上換發含 `board:<店>` 的憑證並訂閱,切換分店時跟著換,離開時取消並換回。
 * `boardKey` 是專案在 api `project/realtime-boards.ts` 登記的看板 key,資格看那個看板登記的權限;
 * 沒有權限或店不在可見範圍時 API 不放 `board:`,頁面拿資料仍由 API 判斷。
 * 切換分店直接換成新的店(不經過 null);**只有卸載時**換回只含自己的憑證。
 */
export const useRealtimeBoard = (
  boardKey: string,
  orgId: string | null,
): void => {
  const { setBoard } = useRealtimeContext();
  useEffect(() => {
    setBoard(orgId === null ? null : { key: boardKey, orgId });
  }, [setBoard, boardKey, orgId]);
  useEffect(
    () => () => {
      setBoard(null);
    },
    [setBoard],
  );
};
