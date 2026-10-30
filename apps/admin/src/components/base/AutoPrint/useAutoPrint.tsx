import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useState } from "react";

import {
  type CreatePrintJobInput,
  useCreatePrintJobMutation,
  useDocumentPrintCountQuery,
  usePrintablePrintersQuery,
} from "@repo/graphql";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import {
  PRINT_BUTTON_PERMISSIONS,
  blobToBase64,
  resolvePrinterId,
} from "@/lib/base/print-button";
import { isPrintImageTooLarge } from "@/lib/base/print-image-limits";
import { logPrintFailure } from "@/lib/base/print-log";

import { PrintResultWatch, type WatchedPrintJob } from "./PrintResultWatch";

/** 一次自動列印要送的內容。 */
export interface AutoPrintRequest {
  /** 單據所屬組織(找這家店可用的印表機)。 */
  orgId: string;
  /** 使用處指定的印表機(例:這一台工作站的);不在可選清單就退回組織預設 → 第一台。 */
  preferredPrinterId?: string | null;
  /** 列印工作的單據資訊(`createPrintJob` 除了印表機與影像以外的欄位)。 */
  document: Omit<CreatePrintJobInput, "printerId" | "image">;
  /** 產生要印的 PNG(找到印表機才叫;失敗照樣只記 log)。 */
  renderImage: () => Promise<Blob>;
  /**
   * 影像超過高度 / 大小上限(api 一定擋)時:不送,改叫這個讓使用處告訴使用者怎麼補印;
   * 參數是那張單據目前的已印次數(查不到算 0)。不給 = 只記 log。
   */
  onTooLarge?: (printedCount: number) => void;
  /** 記 log 時多帶的資訊(例:單據種類)。 */
  logDetail?: Record<string, unknown>;
}

export interface AutoPrint {
  /** 有 `api.printing.print`(沒有就什麼都不印;使用處可據此省掉為列印而查的資料)。 */
  canPrint: boolean;
  /**
   * 寫入成功之後自動列印:沒有權限或組織沒有可用的印表機 → 不印;任何失敗(查印表機、轉圖、建立工作)
   * 只記 log(`logPrintFailure`),不拋錯、不跳提示,使用處照常往下做。
   * 工作有結果時重查那張單據的已印次數(使用處還掛著 `host` 時),列印按鈕跟著變 [補印]。
   */
  printAfterCommit: (request: AutoPrintRequest) => Promise<void>;
  /** 等列印結果的節點(不畫任何東西):使用處要把它放進畫面。 */
  host: ReactNode;
}

/**
 * 寫入成功後在背景送出的列印(docs/modules/printers.md「自動列印」):選印表機、轉 base64、檢查影像上限、
 * 建立列印工作、等結果(`usePrintJobResult`)後更新已印次數;影像怎麼排版由使用處的 `renderImage` 決定。
 * 使用者自己按的 [列印] / [補印] 走 `PrintButton`。
 */
export const useAutoPrint = (): AutoPrint => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canPrint = hasPermission(PRINT_BUTTON_PERMISSIONS.print);
  // 自動列印的回饋只有 log(失敗由列印失敗通知告訴要求人),不跳提示
  const { mutateAsync: createPrintJob } = useCreatePrintJobMutation(
    session.client,
    useMutationFeedback({ success: null, error: () => null }),
  );
  const [watching, setWatching] = useState<WatchedPrintJob[]>([]);

  const printedCountOf = useCallback(
    (refType: string, refId: string): Promise<number> =>
      queryClient
        .fetchQuery({
          queryKey: useDocumentPrintCountQuery.getKey({
            input: { refType, refId },
          }),
          queryFn: useDocumentPrintCountQuery.fetcher(session.client, {
            input: { refType, refId },
          }),
        })
        .then((data) => data.documentPrintCount.printedCount)
        .catch(() => 0),
    [queryClient, session.client],
  );

  const printAfterCommit = useCallback(
    async ({
      orgId,
      preferredPrinterId = null,
      document,
      renderImage,
      onTooLarge,
      logDetail = {},
    }: AutoPrintRequest): Promise<void> => {
      if (!canPrint) {
        return;
      }
      const detail = { ...logDetail, orgId };
      try {
        const printers = await queryClient.fetchQuery({
          queryKey: usePrintablePrintersQuery.getKey({ orgId }),
          queryFn: usePrintablePrintersQuery.fetcher(session.client, {
            orgId,
          }),
        });
        const { items, defaultPrinterId } = printers.printablePrinters;
        const printerId = resolvePrinterId(
          items,
          preferredPrinterId,
          defaultPrinterId,
        );
        if (printerId === null) {
          logPrintFailure("no printer", detail);
          return;
        }
        const image = await blobToBase64(await renderImage());
        if (isPrintImageTooLarge(image)) {
          // api 一定擋(INVALID_IMAGE):不送,交給使用處告訴使用者這次沒印出、怎麼補
          logPrintFailure("image too large", detail);
          if (onTooLarge !== undefined) {
            onTooLarge(await printedCountOf(document.refType, document.refId));
          }
          return;
        }
        const created = await createPrintJob({
          input: { printerId, ...document, image },
        });
        const { job } = created.createPrintJob;
        setWatching((current) => [
          ...current,
          { job, refType: document.refType, refId: document.refId },
        ]);
      } catch (error) {
        logPrintFailure("print failed", { ...detail, error });
      }
    },
    [canPrint, createPrintJob, printedCountOf, queryClient, session.client],
  );

  const onWatched = useCallback((jobId: string) => {
    setWatching((current) => current.filter((item) => item.job.id !== jobId));
  }, []);

  const host = watching.map((item) => (
    <PrintResultWatch key={item.job.id} watched={item} onDone={onWatched} />
  ));

  return { canPrint, printAfterCommit, host };
};
