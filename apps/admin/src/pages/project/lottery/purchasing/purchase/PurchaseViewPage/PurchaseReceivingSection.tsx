import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type CompleteLotteryPurchaseReceivingMutation,
  type CompleteLotteryPurchaseReceivingMutationVariables,
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  useCompleteLotteryPurchaseReceivingMutation,
  useLotteryPurchaseReceivingQuery,
  useNotifyLotteryPurchaseWrongStoreMutation,
  useReceiveLotteryPurchaseBookMutation,
} from "@repo/graphql";

import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import {
  type ReceiveBookGroup,
  ReceiveBooksPanel,
  type ReceiveScanOutcome,
} from "@/components/project/lottery/ReceiveBooksPanel/ReceiveBooksPanel";
import {
  useMutationFeedback,
  useSnackbar,
} from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { purchaseReceivingInputOf } from "@/lib/project/lottery/receipts/purchase-receiving-receipt";
import { logReceiptPrintFailure } from "@/lib/project/lottery/receipts/receipt-log";

import { WrongStoreDialog } from "./WrongStoreDialog";
import { type WrongStoreInfo, receiveErrorOf } from "./receive-error";
import { usePurchaseReceiving } from "./usePurchaseReceiving";

export interface PurchaseReceivingSectionProps {
  submission: FormSubmissionFieldsFragment;
}

/**
 * 進貨單的點收區塊(專案規格 8.2;檢視頁與申請中心詳情頁共用):店長(點收任務在自己手上,api 回的
 * `canReceive`)逐本刷條碼;「這一次」= 上次 [完成這次點收](或打開這頁)之後點收的本。
 *
 * - [完成這次點收] 結束這一次,寫入成功後自動印進貨點收單兩張(店鋪留存、送貨人留存;規格第 12 章;列印失敗只記 log)
 * - 送錯分店:擋下、不入庫,彈窗提示;[知道了] 不記錄,[通知總部更正] 通知那張單的建立者
 * - 點收結果換上 api 回的點收區塊(`lotteryPurchaseReceiving` 的快取),同頁的提示、列印跟著變
 */
export const PurchaseReceivingSection = ({
  submission,
}: PurchaseReceivingSectionProps) => {
  const tReceive = useTranslations("admin.lotteryPurchasing.receive");
  const showSnackbar = useSnackbar();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const id = submission.id;
  const data = usePurchaseReceiving(id);
  const [thisTime, setThisTime] = useState<ReadonlySet<string>>(new Set());
  const [wrongStore, setWrongStore] = useState<{
    code: string;
    info: WrongStoreInfo;
  } | null>(null);

  const receive = useReceiveLotteryPurchaseBookMutation(session.client);
  const printer = useReceiptPrinter();
  const { fetchLinks } = useReceiptLinks();
  const notify = useNotifyLotteryPurchaseWrongStoreMutation(session.client);
  const receivingKey = useLotteryPurchaseReceivingQuery.getKey({
    submissionId: id,
  });
  const complete = useCompleteLotteryPurchaseReceivingMutation(
    session.client,
    useMutationFeedback<
      CompleteLotteryPurchaseReceivingMutation,
      CompleteLotteryPurchaseReceivingMutationVariables
    >({
      success: (_payload, variables) =>
        tReceive("completed", { count: variables.input.rowIds.length }),
      error: (error) => tReceive(`errors.${receiveErrorOf(error).reason}`),
      onSuccess: ({ completeLotteryPurchaseReceiving: result }) => {
        queryClient.setQueryData(receivingKey, {
          lotteryPurchaseReceiving: result.receiving,
        });
        setThisTime(new Set());
        const batch = result.batch ?? null;
        if (batch !== null) {
          // QR 連到進貨單檢視頁:路由依模組樹(`lotteryReceiptLinks`),不依點收人自己的頁面權限
          void fetchLinks()
            .then((links) =>
              printer.printReceiptAfterCommit(
                "purchase-receiving",
                purchaseReceivingInputOf(
                  submission,
                  result.receiving,
                  batch,
                  links.purchaseViewUrl(id),
                ),
              ),
            )
            .catch((error: unknown) => {
              // 讀不到 QR 的路由:不印,只記 log
              logReceiptPrintFailure("links failed", {
                kind: "purchase-receiving",
                error,
              });
            });
        }
      },
    }),
  );

  const onScan = async (
    code: string,
    gameId: string | null,
  ): Promise<ReceiveScanOutcome> => {
    try {
      const result = await receive.mutateAsync({
        input: { submissionId: id, code, gameId },
      });
      const { rowId } = result.receiveLotteryPurchaseBook;
      setThisTime((current) => new Set([...current, rowId]));
      queryClient.setQueryData(receivingKey, {
        lotteryPurchaseReceiving: result.receiveLotteryPurchaseBook.receiving,
      });
      return { kind: "received" };
    } catch (error) {
      const parsed = receiveErrorOf(error);
      if (parsed.wrongStore !== null) {
        setWrongStore({ code, info: parsed.wrongStore });
        return { kind: "failed", message: null };
      }
      const message = tReceive(`errors.${parsed.reason}`);
      return parsed.gameIds.length > 0
        ? { kind: "ambiguous_game", gameIds: parsed.gameIds, message }
        : { kind: "failed", message };
    }
  };

  const groups: ReceiveBookGroup[] = (data?.groups ?? []).map((group) => ({
    key: group.gameId,
    title: tReceive("groupTitle", {
      code: group.gameCode,
      name: group.gameName,
      price: group.unitPrice,
    }),
    requestedBooks: group.requestedBooks ?? null,
    rows: group.rows.map((row) => ({
      rowId: row.rowId,
      bookNo: row.bookNo.startsWith("0") ? row.bookNo.slice(1) : row.bookNo,
      ticketText: String(row.lastTicketNo).padStart(3, "0"),
      tickets: row.tickets,
      bookPrice: row.bookPrice,
      rate: row.rate,
      amount: row.amount,
      status: row.received ? "received" : "notReceived",
    })),
  }));
  const gameLabelOf = (gameId: string): string => {
    const group = data?.groups.find((item) => item.gameId === gameId);
    return group === undefined ? gameId : `${group.gameCode} ${group.gameName}`;
  };
  const isSubmitted = submission.status !== FormSubmissionStatus.Draft;

  return (
    <>
      {data !== null && data.totalCount > 0 && isSubmitted && (
        <ReceiveBooksPanel
          groups={groups}
          canReceive={data.canReceive}
          onScan={onScan}
          gameLabelOf={gameLabelOf}
          thisTimeCount={thisTime.size}
          onComplete={() => {
            complete.mutate({
              input: { submissionId: id, rowIds: [...thisTime] },
            });
          }}
          isPending={receive.isPending}
        />
      )}
      {printer.host}
      {wrongStore !== null && (
        <WrongStoreDialog
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
                showSnackbar("success", tReceive("wrongStore.notified"));
                setWrongStore(null);
              })
              .catch(() => {
                showSnackbar("error", tReceive("errors.UNEXPECTED"));
              });
          }}
        />
      )}
    </>
  );
};
