import { useEffect, useRef, useState } from "react";

import { PRINT_SIGNALS } from "@repo/domain/printing";
import {
  type PrintJobError,
  type PrintJobFieldsFragment,
  PrintJobStatus,
  usePrintJobQuery,
  usePrintPrinterTestPageMutation,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useRealtimeSignal } from "@/hooks/base/useRealtime";
import { useSession } from "@/hooks/base/useSession";

import { type PrintersErrorCode, printersErrorOf } from "../printers-error";
import { testPageImageOf } from "./test-page-image";

/**
 * 等結果時的輪詢間隔:主要靠 `print-result` 信號;即時通道斷線(慢速模式)時靠它補。
 * 工作 2 分鐘沒結果 api 會標失敗(讀取時順手判斷),所以輪詢一定會停。
 */
const RESULT_POLL_MS = 5000;

export type TestPrintOutcome =
  /** 轉圖 / 建立工作中,或工作還在等待中 / 已送出 */
  | { kind: "printing"; isSent: boolean }
  | { kind: "printed" }
  /** 工作失敗(缺紙、代理程式離線…) */
  | { kind: "failed"; error: PrintJobError | null }
  /** 沒有建成工作:api 擋下(權限、印表機已停用…)或轉圖失敗 */
  | { kind: "rejected"; code: PrintersErrorCode };

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
 * 開窗即印 —— 測試頁節點轉圖 → `printPrinterTestPage` → 等結果(`print-result` 信號 + 輪詢 `printJob`)。
 * [重試] = 下一輪(`attempt` + 1)再印一次。
 *
 * 結果就顯示在對話框裡(那就是這次操作的回饋),所以 mutation 不另跳 Snackbar
 * (`useMutationFeedback` 兩邊都給 null;DATA-06 的「錯誤已就地顯示在開著的彈窗裡」)。
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
      refetchInterval: (query) =>
        isFinished(query.state.data?.printJob.job) ? false : RESULT_POLL_MS,
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
