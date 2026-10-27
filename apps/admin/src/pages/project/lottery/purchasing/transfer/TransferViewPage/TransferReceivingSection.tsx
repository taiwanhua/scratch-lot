import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type CompleteLotteryTransferReceivingMutation,
  type CompleteLotteryTransferReceivingMutationVariables,
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  useCompleteLotteryTransferReceivingMutation,
  useLotteryTransferReceivingQuery,
  useNotifyLotteryTransferWrongStoreMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";

import { receiptLinksOf } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { ReceiveBooksPanel } from "@/components/project/lottery/ReceiveBooksPanel/ReceiveBooksPanel";
import {
  useMutationFeedback,
  useSnackbar,
} from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { TransferWrongStoreDialog } from "./TransferWrongStoreDialog";
import {
  type TransferWrongStoreInfo,
  transferReceiveErrorOf,
} from "./transfer-receive-error";
import { unreceivedTextOf } from "./transfer-unreceived";
import { useTransferBookGroups } from "./useTransferBookGroups";
import { useTransferReceipts } from "./useTransferReceipts";
import { useTransferReceiving } from "./useTransferReceiving";

export interface TransferReceivingSectionProps {
  submission: FormSubmissionFieldsFragment;
}

/**
 * 調貨單的點收區塊(專案規格 8.4;檢視頁與申請中心詳情頁共用):出貨之後才出現,收貨店店長的點收任務在手上
 * 才能刷(api 回的 `canReceive`)。整本的列刷一張整列點收;選張的列逐張點收(`useTransferReceiving`)。
 *
 * - 點收過一部分還有張沒到時(審核中)提示哪幾張(核准會被擋下,沒到的請退回由出貨店移除)
 * - [完成這次點收] 寫入成功後自動印這一次的調貨點收單(兩聯,一個列印工作;列印失敗只記 log)
 * - 送錯分店:擋下、不入庫,彈窗提示這本屬於哪一家店的哪一張調貨單
 * - 點收結果換上 api 回的點收區塊(`lotteryTransferReceiving` 的快取)、結算重查,同頁的標頭、提示跟著變
 */
export const TransferReceivingSection = ({
  submission,
}: TransferReceivingSectionProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.view");
  const tReceive = useTranslations("admin.lotteryPurchasing.receive");
  const showSnackbar = useSnackbar();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const id = submission.id;
  const receiving = useLotteryTransferReceivingQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "" },
  );
  const data = receiving.data?.lotteryTransferReceiving ?? null;
  const [wrongStore, setWrongStore] = useState<{
    code: string;
    info: TransferWrongStoreInfo;
  } | null>(null);
  const notify = useNotifyLotteryTransferWrongStoreMutation(session.client);
  const receiving$ = useTransferReceiving(id, data, (code, info) => {
    setWrongStore({ code, info });
  });
  const rows = data?.rows ?? [];
  const { groups, gameLabelOf } = useTransferBookGroups(
    submission,
    rows,
    receiving$.rowReceivingOf,
  );
  const isShipped = rows.some((row) => row.shipped);
  const isReviewing = submission.status === FormSubmissionStatus.Reviewing;
  const unreceivedText = isReviewing ? unreceivedTextOf(t, rows) : null;

  const receipts = useTransferReceipts(id, submission, data, null);
  const printer = useReceiptPrinter();
  // [完成這次點收]:這一次的列標上點收批次(寫入成功後才印這一次的調貨點收單兩聯;列印失敗只記 log)
  const complete = useCompleteLotteryTransferReceivingMutation(
    session.client,
    useMutationFeedback<
      CompleteLotteryTransferReceivingMutation,
      CompleteLotteryTransferReceivingMutationVariables
    >({
      success: (_payload, variables) =>
        tReceive("completed", { count: variables.input.rowIds.length }),
      error: (error) =>
        tReceive(`errors.${transferReceiveErrorOf(error).reason}`),
      onSuccess: ({ completeLotteryTransferReceiving: result }) => {
        queryClient.setQueryData(
          useLotteryTransferReceivingQuery.getKey({ submissionId: id }),
          { lotteryTransferReceiving: result.receiving },
        );
        receiving$.resetThisTime();
        const batch = result.batch ?? null;
        // 印不印只看 api 回的結果:有這一次的點收批次才印(資料也用 api 回的點收區塊)
        const inputOf = receipts.receivingInputOf;
        if (batch !== null && inputOf !== null) {
          // QR 連到調貨單檢視頁:路由和寫入同一次請求帶回(依模組樹,不依點收人自己的頁面權限;
          // 沒有路由 → 照印、不印 QR)
          void printer.printReceiptAfterCommit(
            "transfer-receiving",
            inputOf(
              result.receiving,
              batch,
              receiptLinksOf(result.receiptLinks).transferViewUrl(id),
            ),
          );
        }
      },
    }),
  );

  return (
    <>
      {data !== null && rows.length > 0 && isShipped && (
        <ReceiveBooksPanel
          groups={groups.map((group) => ({ ...group, requestedBooks: null }))}
          canReceive={data.canReceive}
          onScan={receiving$.onScan}
          gameLabelOf={gameLabelOf}
          thisTimeCount={receiving$.thisTime.size}
          onComplete={() => {
            complete.mutate({
              input: { submissionId: id, rowIds: [...receiving$.thisTime] },
            });
          }}
          isPending={receiving$.isPending}
          columnLabels={{
            ticket: t("columns.ticketNos"),
            bookPrice: t("columns.amount"),
          }}
        />
      )}
      {unreceivedText !== null && (
        <Alert severity="warning">{unreceivedText}</Alert>
      )}
      {wrongStore !== null && (
        <TransferWrongStoreDialog
          info={wrongStore.info}
          isNotifying={notify.isPending}
          onClose={() => {
            setWrongStore(null);
          }}
          onNotify={() => {
            void notify
              .mutateAsync({
                input: { submissionId: id, code: wrongStore.code },
              })
              .then(() => {
                showSnackbar("success", t("wrongStoreNotified"));
                setWrongStore(null);
              })
              .catch(() => {
                showSnackbar("error", tReceive("errors.UNEXPECTED"));
              });
          }}
        />
      )}
      {printer.host}
    </>
  );
};
