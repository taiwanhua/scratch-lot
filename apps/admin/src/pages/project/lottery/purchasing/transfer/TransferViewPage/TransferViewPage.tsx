import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  TRANSFER_MODE,
  TRANSFER_SETTLEMENT_SIDE,
  formatTicketRanges,
  transferLinesOf,
  transferSettlementProblemOf,
} from "@repo/domain/project/lottery";
import {
  type CompleteLotteryTransferReceivingMutation,
  type CompleteLotteryTransferReceivingMutationVariables,
  FormSubmissionStatus,
  type LotterySettlementFieldsFragment,
  type LotteryTransferReceivingFieldsFragment,
  useCompleteLotteryTransferReceivingMutation,
  useLotterySettlementQuery,
  useLotteryTransferReceivingQuery,
  useNotifyLotteryTransferWrongStoreMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import {
  BookGroupList,
  type BookListLabels,
  type BookListRow,
} from "@/components/project/lottery/BookGroupList/BookGroupList";
import { groupBooksByGame } from "@/components/project/lottery/BookGroupList/book-groups";
import { useBookProgressLabel } from "@/components/project/lottery/BookGroupList/useBookProgressLabel";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import { ReceiveBooksPanel } from "@/components/project/lottery/ReceiveBooksPanel/ReceiveBooksPanel";
import { SettlementPanel } from "@/components/project/lottery/SettlementPanel/SettlementPanel";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import {
  useMutationFeedback,
  useSnackbar,
} from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { TRANSFER_MODULE_KEY, formatMoney } from "../transfer-keys";
import { TransferPrintButtons } from "./TransferPrintButtons";
import { TransferWrongStoreDialog } from "./TransferWrongStoreDialog";
import {
  type TransferWrongStoreInfo,
  transferReceiveErrorOf,
} from "./transfer-receive-error";
import { unreceivedTextOf } from "./transfer-unreceived";
import { useTransferReceipts } from "./useTransferReceipts";
import { useTransferReceiving } from "./useTransferReceiving";

type Row = LotteryTransferReceivingFieldsFragment["rows"][number];
type Settlement = LotterySettlementFieldsFragment;

/** 標頭第一列(返回、列印、編輯):窄螢幕時換行。 */
const HEADER_ROW_SX = { alignItems: "center", flexWrap: "wrap", rowGap: 1 };

const displayBookNo = (bookNo: string): string =>
  bookNo.startsWith("0") ? bookNo.slice(1) : bookNo;

const ticketsText = (row: Row) => formatTicketRanges(row.ticketNos);

/** 核准前三個數字不相等時,提示哪一邊還沒記(規格 8.4「核准前」;api 也擋)。 */
const settlementProblemOf = (settlement: Settlement) => {
  const totalsOf = (side: string) => {
    const found = settlement.sides.find((item) => item.side === side);
    return { out: found?.totalOut ?? 0, in: found?.totalIn ?? 0 };
  };
  return transferSettlementProblemOf(
    settlement.payable,
    totalsOf(TRANSFER_SETTLEMENT_SIDE.receiver),
    totalsOf(TRANSFER_SETTLEMENT_SIDE.shipper),
  );
};

/**
 * 調貨單的替換檢視頁(專案規格 8.4「頁面」;Figma PU-10a 出貨確認 92:2768 / 573:111230 / 573:111385、
 * PU-10b 點收與結算 127:26050 / 127:27289 / 127:27667):
 *
 * - 標頭:單號、關卡標籤(第一關出貨確認 / 第二關點收)、出貨店 → 收貨店、叫貨單、建立者
 * - 第一關(還沒出貨):出貨確認清單(遊戲、本、方式、張號、張數、金額、批購金額率、批購金額)
 * - 出貨之後:點收區塊(與進貨單共用 `ReceiveBooksPanel`;收貨店店長的點收任務在手上才能刷)。整本的列刷一張
 *   整列點收;選張的列逐張點收(刷背面編號 → 那一列展開、捲到並閃一下;展開格子點選 → [點收選取的 N 張];
 *   [其餘全部到齊…] 確認後點收剩下的張;`TransferRowTickets`)。列顯示「未點收 0 / 10」「部分點收 9 / 12」「已點收」,
 *   點收過一部分還有張沒到時提示哪幾張(核准會被擋下,沒到的請退回由出貨店移除)
 * - 結算區塊(兩邊店的收付;按鈕依 `pay` / `receive` 與分店)+ 核准前三個數字不相等的提示 + 審核區塊
 * - 送錯分店:擋下、不入庫,彈窗提示這本屬於哪一家店的哪一張調貨單
 * - 列印(規格第 12 章):標頭 [列印](`useTransferReceipts`);第一關通過後的自動列印是調貨單的審核擴充(`TransferShipmentEffect`);
 *   收貨店 [完成這次點收] 寫入成功後自動印這一次的調貨點收單(兩聯,一個列印工作)
 */
export const TransferViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.view");
  const tReceive = useTranslations("admin.lotteryPurchasing.receive");
  const tPages = useTranslations("admin.formEngine.pages");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const access = useFormModuleAccess(TRANSFER_MODULE_KEY);
  const id = routeParam ?? "";
  const { submission } = useFormSubmission(id);
  const serialNo = submission?.serialNo ?? null;
  useRouteTabItemLabel(serialNo);

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

  const isSubmitted =
    submission !== null && submission.status !== FormSubmissionStatus.Draft;
  const settlement = useLotterySettlementQuery(
    session.client,
    { moduleKey: TRANSFER_MODULE_KEY, refId: id },
    { enabled: isSubmitted, retry: false },
  );

  const rows = data?.rows ?? [];
  const isShipped = rows.some((row) => row.shipped);
  const isReviewing = submission?.status === FormSubmissionStatus.Reviewing;
  const modeText = (row: Row) =>
    row.mode === TRANSFER_MODE.whole ? t("modes.whole") : t("modes.partial");

  // 一列 = 一本(或一本的選張);依遊戲分組(出貨確認清單與點收同一個清單元件)
  const gameIdOf = new Map(
    transferLinesOf(submission?.values ?? {}).map((line) => [
      line.rowId,
      line.gameId,
    ]),
  );
  const bookRowOf = (row: Row): BookListRow => ({
    rowId: row.rowId,
    bookNo: displayBookNo(row.bookNo),
    detail: modeText(row),
    ticketText: ticketsText(row),
    tickets: row.tickets,
    bookPrice: row.amount,
    rate: row.rate,
    amount: row.purchaseAmount,
    ...receiving$.rowReceivingOf(row),
  });
  const groups = groupBooksByGame(
    rows,
    (row) => ({
      key: gameIdOf.get(row.rowId) ?? row.gameCode,
      title: `${row.gameCode} ${row.gameName}`,
    }),
    bookRowOf,
  );
  const gameLabelOf = (gameId: string): string =>
    groups.find((group) => group.key === gameId)?.title ?? gameId;
  const progress = useBookProgressLabel();
  const shipLabels: BookListLabels = {
    columns: {
      bookNo: t("columns.book"),
      ticket: t("columns.ticketNos"),
      tickets: t("columns.tickets"),
      bookPrice: t("columns.amount"),
      rate: t("columns.rate"),
      amount: t("columns.purchaseAmount"),
      status: "",
    },
    status: { received: "", notReceived: "", inTransit: "", partial: "" },
    remove: "",
    rateOf: () => "",
    progress,
    cardFacts: (row) =>
      t("cardFacts", {
        tickets: row.ticketText,
        count: row.tickets,
        rate: row.rate,
        amount: formatMoney(row.amount),
      }),
  };

  const settlementItem = settlement.data?.lotterySettlement.item ?? null;
  const allReceived =
    data !== null &&
    data.totalCount > 0 &&
    data.receivedCount === data.totalCount;
  const problem =
    isReviewing && allReceived && settlementItem !== null
      ? settlementProblemOf(settlementItem)
      : null;

  const unreceivedText = isReviewing ? unreceivedTextOf(t, rows) : null;

  let stage: string | null = null;
  if (isReviewing) {
    stage = isShipped ? t("stageReceive") : t("stageShip");
  }

  const creator = submission?.createdBy?.name ?? null;
  const values = submission?.values ?? {};
  const requisitionNo =
    typeof values.requisition === "string" && values.requisition !== ""
      ? values.requisition
      : null;
  const receipts = useTransferReceipts(id, submission, data, settlementItem);
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
        if (batch !== null && receipts.receivingInputOf !== null) {
          void printer.printReceiptAfterCommit(
            "transfer-receiving",
            receipts.receivingInputOf(result.receiving, batch),
          );
        }
      },
    }),
  );

  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}>
      <Stack spacing={2}>
        <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1.5} sx={HEADER_ROW_SX}>
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  if (access.listRoute !== null) {
                    void navigate(tabHref(access.listRoute));
                  }
                }}
              >
                {tPages("backToList")}
              </Button>
              <Box sx={{ flex: 1 }} />
              <TransferPrintButtons receipts={receipts} />
              {access.editRoute !== null &&
                submission?.abilities.canEdit === true && (
                  <Button
                    onClick={() => {
                      void navigate(`${access.editRoute ?? ""}/${id}`);
                    }}
                  >
                    {tPages("edit")}
                  </Button>
                )}
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Typography variant="h6" component="h1">
                {serialNo === null
                  ? t("title")
                  : t("titleWithNo", { serialNo })}
              </Typography>
              {stage === null ? (
                submission !== null && (
                  <SubmissionStatusTag
                    status={submission.status}
                    blocked={submission.blocked}
                  />
                )
              ) : (
                <Tag tone="warning" label={stage} />
              )}
            </Stack>
            {data !== null && (
              <Typography variant="body2" color="textSecondary">
                {[
                  `${data.fromBranchName} → ${data.toBranchName}`,
                  requisitionNo === null
                    ? null
                    : t("requisition", { serialNo: requisitionNo }),
                  t("transferAmount", {
                    amount: formatMoney(data.transferAmount),
                  }),
                  creator === null ? null : t("createdBy", { name: creator }),
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </Typography>
            )}
          </Stack>
        </Card>
        {data !== null && rows.length > 0 && !isShipped && (
          <BookGroupList
            mode="view"
            title={t("shipList")}
            labels={shipLabels}
            groups={groups.map((group) => ({
              ...group,
              rows: group.rows.map((row) => ({ ...row, status: null })),
            }))}
          />
        )}
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
        {settlementItem !== null && (
          <SettlementPanel moduleKey={TRANSFER_MODULE_KEY} refId={id} />
        )}
        {problem !== null && (
          <Alert severity="warning">
            {t(`problems.${problem.kind}`, {
              amount: formatMoney(problem.amount),
            })}
          </Alert>
        )}
        {submission?.currentInstanceId !== null &&
          submission?.currentInstanceId !== undefined && (
            <ApprovalSection
              instanceId={submission.currentInstanceId}
              submission={submission}
              onCopied={(copiedId) => {
                if (access.editRoute !== null) {
                  void navigate(`${access.editRoute}/${copiedId}`);
                }
              }}
            />
          )}
      </Stack>
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
    </Box>
  );
};
