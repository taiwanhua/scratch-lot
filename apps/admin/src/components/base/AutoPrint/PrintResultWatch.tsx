import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  type PrintJobFieldsFragment,
  useDocumentPrintCountQuery,
} from "@repo/graphql";

import {
  isPrintJobFinished,
  usePrintJobResult,
} from "@/hooks/base/usePrintJobResult";

/** 一張自動送出的列印工作(`useAutoPrint` 等它的結果)。 */
export interface WatchedPrintJob {
  job: PrintJobFieldsFragment;
  refType: string;
  refId: string;
}

/**
 * 等一張自動列印的工作有結果(共用的 `usePrintJobResult`:`print-result` 信號 + 依連線狀態補查),
 * 有結果就重查那張單據的已印次數 —— 標頭的 [列印] 跟著變 [補印]「已印 1 次」,不會停在送出當下查到的 0
 * (那時工作還在等待中),按下去多印一次。不畫任何東西。
 */
export const PrintResultWatch = ({
  watched,
  onDone,
}: {
  watched: WatchedPrintJob;
  onDone: (jobId: string) => void;
}) => {
  const queryClient = useQueryClient();
  const result = usePrintJobResult(watched.job);
  const isFinished = isPrintJobFinished(result);
  const { refType, refId, job } = watched;

  useEffect(() => {
    if (!isFinished) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: useDocumentPrintCountQuery.getKey({
        input: { refType, refId },
      }),
    });
    onDone(job.id);
  }, [isFinished, job.id, onDone, queryClient, refId, refType]);

  return null;
};
