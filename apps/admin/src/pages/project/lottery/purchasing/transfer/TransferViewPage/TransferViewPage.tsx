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
  FormSubmissionStatus,
  type LotterySettlementFieldsFragment,
  type LotteryTransferReceivingFieldsFragment,
  useLotterySettlementQuery,
  useLotteryTransferReceivingQuery,
  useNotifyLotteryTransferWrongStoreMutation,
  useReceiveLotteryTransferBookMutation,
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
import {
  ReceiveBooksPanel,
  type ReceiveScanOutcome,
} from "@/components/project/lottery/ReceiveBooksPanel/ReceiveBooksPanel";
import { SettlementPanel } from "@/components/project/lottery/SettlementPanel/SettlementPanel";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
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
import { useTransferReceipts } from "./useTransferReceipts";

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
 * - 出貨之後:點收區塊(與進貨單共用 `ReceiveBooksPanel`;收貨店店長的點收任務在手上才能刷)
 * - 結算區塊(兩邊店的收付;按鈕依 `pay` / `receive` 與分店)+ 核准前三個數字不相等的提示 + 審核區塊
 * - 送錯分店:擋下、不入庫,彈窗提示這本屬於哪一家店的哪一張調貨單
 * - 列印(規格第 12 章):標頭 [列印](`useTransferReceipts`);第一關通過後的自動列印是調貨單的審核擴充(`TransferShipmentEffect`)
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
  const [thisTime, setThisTime] = useState<ReadonlySet<string>>(new Set());
  const [wrongStore, setWrongStore] = useState<{
    code: string;
    info: TransferWrongStoreInfo;
  } | null>(null);
  const notify = useNotifyLotteryTransferWrongStoreMutation(session.client);
  const receive = useReceiveLotteryTransferBookMutation(session.client);

  const isSubmitted =
    submission !== null && submission.status !== FormSubmissionStatus.Draft;
  const settlement = useLotterySettlementQuery(
    session.client,
    { moduleKey: TRANSFER_MODULE_KEY, refId: id },
    { enabled: isSubmitted, retry: false },
  );

  const onScan = async (
    code: string,
    gameId: string | null,
  ): Promise<ReceiveScanOutcome> => {
    try {
      const result = await receive.mutateAsync({
        input: { submissionId: id, code, gameId },
      });
      const { rowId } = result.receiveLotteryTransferBook;
      setThisTime((current) => new Set([...current, rowId]));
      queryClient.setQueryData(
        useLotteryTransferReceivingQuery.getKey({ submissionId: id }),
        {
          lotteryTransferReceiving: result.receiveLotteryTransferBook.receiving,
        },
      );
      void queryClient.invalidateQueries({
        queryKey: useLotterySettlementQuery.getKey({
          moduleKey: TRANSFER_MODULE_KEY,
          refId: id,
        }),
      });
      return { kind: "received" };
    } catch (error) {
      const parsed = transferReceiveErrorOf(error);
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
    status: row.received ? "received" : "notReceived",
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
    status: { received: "", notReceived: "", inTransit: "" },
    remove: "",
    rateOf: () => "",
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
            groups={groups}
            canReceive={data.canReceive}
            onScan={onScan}
            gameLabelOf={gameLabelOf}
            thisTimeCount={thisTime.size}
            onComplete={() => {
              showSnackbar(
                "success",
                tReceive("completed", { count: thisTime.size }),
              );
              setThisTime(new Set());
            }}
            isPending={receive.isPending}
            columnLabels={{
              ticket: t("columns.ticketNos"),
              bookPrice: t("columns.amount"),
            }}
          />
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
    </Box>
  );
};
