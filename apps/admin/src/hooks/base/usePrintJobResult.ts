import { useEffect, useRef } from "react";

import {
  PRINT_JOB_CLAIM_TIMEOUT_MS,
  PRINT_SIGNALS,
} from "@repo/domain/printing";
import {
  type PrintJobFieldsFragment,
  PrintJobStatus,
  usePrintJobQuery,
} from "@repo/graphql";

import { useRealtimeSignal, useRealtimeStatus } from "./useRealtime";
import { useSession } from "./useSession";

/**
 * 連著即時通道(`live`)時的補查間隔:建立後約 2 分鐘(逾時判斷之後)查一次,之後每隔這麼久再查。
 * api 在讀取時把逾時的工作標失敗(等待中 → 代理程式離線;已送出 → 未收到列印結果),
 * 快到 2 分鐘才被認領的「已送出」工作在下一次補查就有結果。多 5 秒避開邊界(兩邊時鐘不會剛好對齊)。
 */
export const PRINT_RESULT_LIVE_CHECK_MS = PRINT_JOB_CLAIM_TIMEOUT_MS + 5000;

/** 沒連上即時通道(連線中 / 慢速模式)時的輪詢間隔:馬上查一次,之後每 5 秒。 */
export const PRINT_RESULT_SLOW_POLL_MS = 5000;

/** 記住幾個「工作建立回應還沒回來就先到」的信號(只是暫存,超過就丟最舊的)。 */
const EARLY_SIGNAL_LIMIT = 20;

/** 各狀態的查詢間隔(`false` = 不再查)。 */
const POLL_INTERVAL: Readonly<
  Record<"done" | "live" | "slow", number | false>
> = {
  done: false,
  live: PRINT_RESULT_LIVE_CHECK_MS,
  slow: PRINT_RESULT_SLOW_POLL_MS,
};

/** 已印 / 失敗 = 有結果,停止查詢。 */
export const isPrintJobFinished = (
  job: Pick<PrintJobFieldsFragment, "status"> | null | undefined,
): boolean =>
  job?.status === PrintJobStatus.Printed ||
  job?.status === PrintJobStatus.Failed;

const pollStateOf = (
  job: PrintJobFieldsFragment | undefined,
  isLive: boolean,
): keyof typeof POLL_INTERVAL => {
  if (isPrintJobFinished(job)) {
    return "done";
  }
  return isLive ? "live" : "slow";
};

/**
 * 一張列印工作的結果(列印按鈕、印表機管理頁的測試列印共用;docs/modules/printers.md「等列印結果」)。
 *
 * - 主要靠 `print-result` 信號(`user:<自己>`,`id` = 工作 id;RT-02 信號不帶資料)→ 立刻查 `printJob`。
 * - 信號比建立工作的回應先到(代理程式很快、回應很慢)→ 以工作 id 暫存,拿到工作時馬上查。
 * - `live`:建立回應就是第一份資料(不馬上查),約 2 分鐘補查一次、之後每 2 分鐘;
 *   `connecting` / `slow`:馬上查,之後每 5 秒。連線狀態變了就換節奏。
 * - 已印 / 失敗就停;元件卸載時查詢跟著停(TanStack Query)。
 *
 * @param createdJob 建立工作時 api 回的那一筆;還沒建立(或送不出去)給 `undefined`
 * @returns 最新的那一筆(還沒查過就是 `createdJob`)
 */
export const usePrintJobResult = (
  createdJob: PrintJobFieldsFragment | undefined,
): PrintJobFieldsFragment | undefined => {
  const { session } = useSession();
  const isLive = useRealtimeStatus() === "live";
  const earlySignals = useRef<string[]>([]);

  const query = usePrintJobQuery(
    session.client,
    { id: createdJob?.id ?? "" },
    {
      enabled: createdJob !== undefined && !isPrintJobFinished(createdJob),
      // 建立時回的工作就是第一份資料:live 時不必馬上再查(等信號);沒連上時當作過期,掛上就查
      initialData:
        createdJob === undefined
          ? undefined
          : { printJob: { job: createdJob } },
      staleTime: isLive ? Number.POSITIVE_INFINITY : 0,
      refetchInterval: (current) =>
        POLL_INTERVAL[pollStateOf(current.state.data?.printJob.job, isLive)],
    },
  );
  const { refetch } = query;
  const jobId = createdJob?.id;

  useRealtimeSignal(PRINT_SIGNALS.result, (signal) => {
    if (signal.id === undefined) {
      return;
    }
    if (signal.id === jobId) {
      void refetch();
      return;
    }
    // 可能是建立回應還沒回來的那一張:先記著
    earlySignals.current = [...earlySignals.current, signal.id].slice(
      -EARLY_SIGNAL_LIMIT,
    );
  });

  useEffect(() => {
    if (jobId === undefined || !earlySignals.current.includes(jobId)) {
      return;
    }
    earlySignals.current = earlySignals.current.filter((id) => id !== jobId);
    void refetch();
  }, [jobId, refetch]);

  return query.data?.printJob.job ?? createdJob;
};
