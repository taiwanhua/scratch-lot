import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { CHECKOUT_CONFIRM_FORM_KEY } from "@repo/domain/project/lottery";
import { useFormSubmissionQuery, useLotteryCheckoutQuery } from "@repo/graphql";

import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { useSession } from "@/hooks/base/useSession";
import type { WorkflowEffectProps } from "@/hooks/base/useWorkflowExtensions";

import { printCheckoutReceipt, useCheckoutReceipt } from "./useCheckoutReceipt";

/**
 * 店面管理的送出後動作(`app/project/workflow-extensions.ts` 登記;規格第 12 章):
 * 結帳確認申請送出成功 → 自動印 58mm 單據 —— 交班 = 交班結帳單、日結 = 日結單。
 * 交班精靈 / 日結精靈的新增頁送出、退回後的編輯頁再送出都會到這裡(送出成功才有事件,送出失敗不印)。
 * 其他表單(盤點確認申請、撤銷售出申請、現金更正單)、審核決定 → 不印;沒有列印權限 → 不印;
 * 任何失敗只記 log(`printReceiptAfterCommit`),做完就卸載。
 */
export const CheckoutReceiptEffect = ({
  event,
  onDone,
}: WorkflowEffectProps) => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { canPrint, printReceiptAfterCommit, host } = useReceiptPrinter();
  const receiptOf = useCheckoutReceipt();
  const { fetchLinks } = useReceiptLinks();
  const started = useRef(false);

  useEffect(() => {
    // StrictMode 會把 effect 跑兩次:一個事件只做一次
    if (started.current) {
      return;
    }
    started.current = true;
    const run = async (): Promise<void> => {
      if (!canPrint || event.kind !== "submitted") {
        return;
      }
      const { submissionId } = event;
      const loaded = await queryClient.fetchQuery({
        queryKey: useFormSubmissionQuery.getKey({ id: submissionId }),
        queryFn: useFormSubmissionQuery.fetcher(session.client, {
          id: submissionId,
        }),
      });
      const submission = loaded.formSubmission.submission;
      if (submission.formKey !== CHECKOUT_CONFIRM_FORM_KEY) {
        return;
      }
      // 送出後結帳單才定案(退回後再送出會改寫):不用快取
      const detail = await queryClient.fetchQuery({
        queryKey: useLotteryCheckoutQuery.getKey({ submissionId }),
        queryFn: useLotteryCheckoutQuery.fetcher(session.client, {
          submissionId,
        }),
        staleTime: 0,
      });
      const receipt = receiptOf(
        detail.lotteryCheckout,
        submission.serialNo ?? null,
        await fetchLinks(),
      );
      await printCheckoutReceipt(printReceiptAfterCommit, receipt);
    };
    run()
      .catch(() => {
        // 讀不到單據:畫面照常(列印是交易後的附帶動作,失敗不打斷)
      })
      .finally(onDone);
  }, [
    canPrint,
    event,
    fetchLinks,
    onDone,
    printReceiptAfterCommit,
    queryClient,
    receiptOf,
    session.client,
  ]);

  return host;
};
