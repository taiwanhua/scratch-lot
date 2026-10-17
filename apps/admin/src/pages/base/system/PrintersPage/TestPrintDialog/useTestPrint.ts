import { useEffect, useRef, useState } from "react";

import {
  PRINT_JOB_CLAIM_TIMEOUT_MS,
  PRINT_SIGNALS,
} from "@repo/domain/printing";
import {
  type PrintJobError,
  type PrintJobFieldsFragment,
  PrintJobStatus,
  usePrintJobQuery,
  usePrintPrinterTestPageMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useRealtimeSignal, useRealtimeStatus } from "@/hooks/base/useRealtime";
import { useSession } from "@/hooks/base/useSession";

import { type PrintersErrorCode, printersErrorOf } from "../printers-error";
import { testPageImageOf } from "./test-page-image";

/**
 * 等結果:即時通道連著(`live`)時靠 `print-result` 信號,只在逾時判斷之後補查一次
 * (api 2 分鐘沒結果會標失敗,讀取時順手判斷;沒人讀時信號可能要等排程);
 * 沒連上(連線中 / 慢速模式)時每 5 秒查一次。工作逾時一定會變成已印或失敗,所以查詢一定會停。
 */
const POLL_INTERVAL: Readonly<
  Record<"done" | "live" | "slow", number | false>
> = {
  done: false,
  live: PRINT_JOB_CLAIM_TIMEOUT_MS + 5000,
  slow: 5000,
};

export type TestPrintOutcome =
  /** 轉圖 / 建立工作中,或工作還在等待中 / 已送出 */
  | { kind: "printing"; isSent: boolean }
  | { kind: "printed" }
  /** 工作失敗(缺紙、代理程式離線…) */
  | { kind: "failed"; error: PrintJobError | null }
  /** 沒有建成工作:api 擋下(權限、印表機已停用…)或轉圖失敗 */
  | { kind: "rejected"; code: PrintersErrorCode };

/** 等結果的查詢該怎麼排:已有結果就停,其餘看即時通道連著沒。 */
const pollStateOf = (
  job: PrintJobFieldsFragment | undefined,
  isLive: boolean,
): keyof typeof POLL_INTERVAL => {
  if (isFinished(job)) {
    return "done";
  }
  return isLive ? "live" : "slow";
};

const isFinished = (job: PrintJobFieldsFragment | undefined): boolean =>
  job?.status === PrintJobStatus.Printed ||
  job?.status === PrintJobStatus.Failed;

const outcomeOf = (
  job: PrintJobFieldsFragment | undefined,
): TestPrintOutcome => {
  switch (job?.status) {
    case PrintJobStatus.Printed: {
      return { kind: "printed" };
    }
    case PrintJobStatus.Failed: {
      return { kind: "failed", error: job.error ?? null };
    }
    default: {
      return { kind: "printing", isSent: job?.status === PrintJobStatus.Sent };
    }
  }
};

/**
 * 測試列印的流程(底座規格「測試頁」;Figma BS-18a / b / c):
 * 開窗即印 —— 測試頁節點轉圖 → `printPrinterTestPage` → 等結果(`print-result` 信號;沒連上即時通道時輪詢 `printJob`)。
 * [重試] = 下一輪(`attempt` + 1)再印一次。
 *
 * 結果就顯示在對話框裡(那就是這次操作的回饋),所以 mutation 不另跳 Snackbar
 * (`useMutationFeedback` 兩邊都給 null;DATA-06「結果就地顯示在開著的彈窗裡等候」)。
 */
export const useTestPrint = (
  printerId: string,
  /**
   * 測試頁節點(callback ref 寫進來的 state):對話框的內容由 Portal 在下一輪才掛上,
   * 第一次 effect 時還拿不到節點,所以等它出現才開始送
   */
  receipt: HTMLDivElement | null,
) => {
  const { session } = useSession();
  const isLive = useRealtimeStatus() === "live";
  const [attempt, setAttempt] = useState(0);
  const [imageFailedAt, setImageFailedAt] = useState<number | null>(null);
  // StrictMode 會把 effect 跑兩次:同一輪只送一次
  const startedAttempt = useRef<number | null>(null);

  const print = usePrintPrinterTestPageMutation(
    session.client,
    useMutationFeedback({ success: null, error: () => null }),
  );
  const { mutate } = print;

  useEffect(() => {
    if (receipt === null || startedAttempt.current === attempt) {
      return;
    }
    startedAttempt.current = attempt;
    void (async () => {
      try {
        const image = await testPageImageOf(receipt);
        mutate({ input: { printerId, image } });
      } catch {
        setImageFailedAt(attempt);
      }
    })();
  }, [attempt, mutate, printerId, receipt]);

  const createdJob = print.data?.printPrinterTestPage.job;
  const jobQuery = usePrintJobQuery(
    session.client,
    { id: createdJob?.id ?? "" },
    {
      enabled: createdJob !== undefined && !isFinished(createdJob),
      // 建立時回的工作就是第一份資料:live 時不必馬上再查(等信號);沒連上時當作過期,掛上就查
      initialData:
        createdJob === undefined
          ? undefined
          : { printJob: { job: createdJob } },
      staleTime: isLive ? Number.POSITIVE_INFINITY : 0,
      refetchInterval: (query) =>
        POLL_INTERVAL[pollStateOf(query.state.data?.printJob.job, isLive)],
    },
  );
  const { refetch } = jobQuery;

  useRealtimeSignal(PRINT_SIGNALS.result, (signal) => {
    if (createdJob !== undefined && signal.id === createdJob.id) {
      void refetch();
    }
  });

  const outcome = ((): TestPrintOutcome => {
    if (imageFailedAt === attempt) {
      return { kind: "rejected", code: "UNEXPECTED" };
    }
    if (print.isError) {
      return { kind: "rejected", code: printersErrorOf(print.error).code };
    }
    return outcomeOf(jobQuery.data?.printJob.job ?? createdJob);
  })();

  const retry = () => {
    print.reset();
    setAttempt((current) => current + 1);
  };

  return { outcome, retry };
};
