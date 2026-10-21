import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { transferHeaderOf } from "@repo/domain/project/lottery";
import {
  WorkflowDecision,
  WorkflowStepStatus,
  useFormSubmissionQuery,
  useLotteryTransferReceivingQuery,
  useWorkflowInstanceQuery,
} from "@repo/graphql";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { useSession } from "@/hooks/base/useSession";
import type {
  WorkflowEffectEvent,
  WorkflowEffectProps,
} from "@/hooks/base/useWorkflowExtensions";
import { transferShipmentInputOf } from "@/lib/project/lottery/receipts/transfer-shipment-receipt";

import { TRANSFER_MODULE_KEY } from "./transfer-keys";

type Instance = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof useWorkflowInstanceQuery.fetcher>>
  >["workflowInstance"]["instance"]
>;

/**
 * 這個事件是不是「第一關(出貨確認)通過」:審核決定 = 在第一關核准,而且第一關已結束(多人都要核准時,
 * 還沒到齊的那幾次不算);送出 = 第一關被跳過(出貨分店的人自己送出)。
 */
const isFirstStepPassed = (
  event: WorkflowEffectEvent,
  instance: Instance,
): boolean => {
  const first = instance.steps.at(0);
  if (first === undefined) {
    return false;
  }
  if (event.kind === "submitted") {
    return first.status === WorkflowStepStatus.Skipped;
  }
  return (
    event.decision === WorkflowDecision.Approve &&
    event.stepKey === first.stepKey &&
    first.status === WorkflowStepStatus.Completed
  );
};

/**
 * 調貨單的審核後 / 送出後動作(`app/project/workflow-extensions.ts` 登記;規格 8.4 / 第 12 章):
 * 第一關通過(含跳過)→ 自動印調貨出貨單,印出貨分店的印表機。不論從哪一頁做(調貨單檢視頁、申請中心詳情頁、
 * 申請中心批次核准、新增頁送出、引擎編輯頁重新送出)都會到這裡。
 * 印的列 = 在途(已出貨、還沒點收)的列。沒有列印權限、不是第一關通過、沒有在途的列 → 不印;
 * 任何失敗只記 log(`printReceiptAfterCommit`),做完就卸載。
 */
export const TransferShipmentEffect = ({
  event,
  onDone,
}: WorkflowEffectProps) => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { canPrint, printReceiptAfterCommit, host } = useReceiptPrinter();
  const { viewRoute } = useFormModuleAccess(TRANSFER_MODULE_KEY);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode 會把 effect 跑兩次:一個事件只做一次
    if (started.current) {
      return;
    }
    started.current = true;
    const run = async (): Promise<void> => {
      if (!canPrint || event.instanceId === null) {
        return;
      }
      const { submissionId } = event;
      const loaded = await queryClient.fetchQuery({
        queryKey: useWorkflowInstanceQuery.getKey({ id: event.instanceId }),
        queryFn: useWorkflowInstanceQuery.fetcher(session.client, {
          id: event.instanceId,
        }),
      });
      const instance = loaded.workflowInstance.instance;
      if (!isFirstStepPassed(event, instance)) {
        return;
      }
      // 審核者讀得到他審的那個修訂(申請中心進來的店長不一定在單據的可見範圍)
      const variables = { id: submissionId, revision: instance.revision };
      const [submission, receiving] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: useFormSubmissionQuery.getKey(variables),
          queryFn: useFormSubmissionQuery.fetcher(session.client, variables),
        }),
        queryClient.fetchQuery({
          queryKey: useLotteryTransferReceivingQuery.getKey({ submissionId }),
          queryFn: useLotteryTransferReceivingQuery.fetcher(session.client, {
            submissionId,
          }),
        }),
      ]);
      const { values, serialNo } = submission.formSubmission.submission;
      const latest = receiving.lotteryTransferReceiving;
      const inTransit = latest.rows.filter(
        (row) => row.shipped && !row.received,
      );
      if (inTransit.length === 0) {
        return;
      }
      await printReceiptAfterCommit(
        "transfer-shipment",
        transferShipmentInputOf(
          latest,
          {
            submissionId,
            serialNo: serialNo ?? null,
            fromBranchId: transferHeaderOf(values).fromBranchId ?? "",
            url: `${globalThis.location.origin}${viewRoute ?? ""}/${submissionId}`,
          },
          inTransit,
        ),
      );
    };
    run()
      .catch(() => {
        // 讀不到實例 / 單據:畫面照常(列印是交易後的附帶動作,失敗不打斷)
      })
      .finally(onDone);
  }, [
    canPrint,
    event,
    onDone,
    printReceiptAfterCommit,
    queryClient,
    session.client,
    viewRoute,
  ]);

  return host;
};
