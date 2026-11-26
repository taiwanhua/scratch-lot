import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { wholesaleHeaderOf } from "@repo/domain/project/lottery";
import {
  WorkflowDecision,
  WorkflowInstanceStatus,
  useFormSubmissionQuery,
  useLotteryWholesaleDetailQuery,
  useWorkflowInstanceQuery,
} from "@repo/graphql";

import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { useSession } from "@/hooks/base/useSession";
import type { WorkflowEffectProps } from "@/hooks/base/useWorkflowExtensions";
import { wholesaleShipmentInputOf } from "@/lib/project/lottery/receipts/wholesale-shipment-receipt";

/**
 * 批售單的審核後動作(`app/project/workflow-extensions.ts` 登記;規格 21.4 `completed`、21.8 列印):
 * 核准完成(審核實例結束 = 已核准 = 出貨)→ 自動印批售出貨單兩聯,印出貨分店的印表機。
 * 不論從哪一頁核准(批售單檢視頁、申請中心詳情頁、申請中心批次核准)都會到這裡。
 * 認「流程結束」不認關卡 key:租戶在出貨確認前面加關卡也照樣在最後才印(同 api 的掛接點)。
 *
 * 沒有列印權限(沒有收據機的租戶)、不是核准、流程還沒結束(多人核准還沒到齊)、還沒出貨 → 不印,核准照常;
 * 任何失敗只記 log(`printReceiptAfterCommit`),做完就卸載。
 */
export const WholesaleShipmentEffect = ({
  event,
  onDone,
}: WorkflowEffectProps) => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { canPrint, printReceiptAfterCommit, host } = useReceiptPrinter();
  // QR 的路由依模組樹(`lotteryReceiptLinks`),不依核准的人的權限
  const { fetchLinks } = useReceiptLinks();
  const started = useRef(false);

  useEffect(() => {
    // StrictMode 會把 effect 跑兩次:一個事件只做一次
    if (started.current) {
      return;
    }
    started.current = true;
    const run = async (): Promise<void> => {
      if (
        !canPrint ||
        event.kind !== "decided" ||
        event.decision !== WorkflowDecision.Approve
      ) {
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
      if (instance.status !== WorkflowInstanceStatus.Approved) {
        return;
      }
      // 審核者讀得到他審的那個修訂(申請中心進來的店長不一定在單據的可見範圍)
      const variables = { id: submissionId, revision: instance.revision };
      const [submission, detail] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: useFormSubmissionQuery.getKey(variables),
          queryFn: useFormSubmissionQuery.fetcher(session.client, variables),
        }),
        queryClient.fetchQuery({
          queryKey: useLotteryWholesaleDetailQuery.getKey({ submissionId }),
          queryFn: useLotteryWholesaleDetailQuery.fetcher(session.client, {
            submissionId,
          }),
        }),
      ]);
      const shipped = detail.lotteryWholesaleDetail;
      if (shipped.shippedAt == null || shipped.rows.length === 0) {
        return;
      }
      const { values, serialNo } = submission.formSubmission.submission;
      const links = await fetchLinks();
      await printReceiptAfterCommit(
        "wholesale-shipment",
        wholesaleShipmentInputOf(shipped, {
          submissionId,
          serialNo: serialNo ?? null,
          fromBranchId: wholesaleHeaderOf(values).fromBranchId ?? "",
          url: links.wholesaleViewUrl(submissionId),
        }),
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
    fetchLinks,
    onDone,
    printReceiptAfterCommit,
    queryClient,
    session.client,
  ]);

  return host;
};
