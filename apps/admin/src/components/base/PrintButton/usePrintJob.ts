import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  type PrintJobError,
  type PrintJobFieldsFragment,
  PrintJobStatus,
  useDocumentPrintCountQuery,
} from "@repo/graphql";

import {
  isPrintJobFinished,
  usePrintJobResult,
} from "@/hooks/base/usePrintJobResult";

/** 按鈕旁顯示的這一次列印的進度。 */
export type PrintPhase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "printed" }
  | { kind: "failed"; error: PrintJobError | null };

/** 這一次列印走到哪(只有這個元件用,所以是 `useState`;REACT-02)。 */
type Attempt =
  | { kind: "idle" }
  /** 轉圖片、建立工作中 */
  | { kind: "sending" }
  /** 工作已建立,等結果 */
  | { kind: "created"; job: PrintJobFieldsFragment };

export interface UsePrintJobResult {
  phase: PrintPhase;
  /** 開始送出(轉圖片、建立工作之前就切到「已送到印表機…」,按鈕不能再按)。 */
  start: () => void;
  /** 建立工作成功:已經有結果(送出時代理程式已離線)就直接顯示,否則等結果。 */
  watch: (job: PrintJobFieldsFragment) => void;
  /** 送出沒成功(轉圖片失敗、API 錯誤):回到原本的樣子,錯誤由呼叫端跳提示。 */
  reset: () => void;
}

const phaseOf = (
  attempt: Attempt,
  job: PrintJobFieldsFragment | undefined,
): PrintPhase => {
  if (attempt.kind === "idle") {
    return { kind: "idle" };
  }
  if (job?.status === PrintJobStatus.Printed) {
    return { kind: "printed" };
  }
  if (job?.status === PrintJobStatus.Failed) {
    return { kind: "failed", error: job.error ?? null };
  }
  return { kind: "sending" };
};

/**
 * 一張單據的列印進度(底座規格第 6 章「列印按鈕元件」):等結果交給共用的 `usePrintJobResult`
 * (`print-result` 信號 + 依即時通道狀態補查 `printJob`;docs/modules/printers.md「等列印結果」),
 * 這裡只把結果換成按鈕旁的進度,有結果後重抓這張單據的已印次數(按鈕變 [補印]、「已印 N 次」)。
 */
export const usePrintJob = (
  refType: string,
  refId: string,
): UsePrintJobResult => {
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState<Attempt>({ kind: "idle" });
  const job = usePrintJobResult(
    attempt.kind === "created" ? attempt.job : undefined,
  );
  const finishedJobId =
    attempt.kind === "created" && isPrintJobFinished(job)
      ? (job?.id ?? null)
      : null;

  useEffect(() => {
    if (finishedJobId === null) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: useDocumentPrintCountQuery.getKey({
        input: { refType, refId },
      }),
    });
  }, [finishedJobId, queryClient, refType, refId]);

  return {
    phase: phaseOf(attempt, job),
    start: () => {
      setAttempt({ kind: "sending" });
    },
    watch: (created) => {
      setAttempt({ kind: "created", job: created });
    },
    reset: () => {
      setAttempt({ kind: "idle" });
    },
  };
};
