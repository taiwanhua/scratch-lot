import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  TRANSFER_MODE,
  TRANSFER_SETTLEMENT_SIDE,
  formatTicketRanges,
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
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import {
  type ReceiveBookGroup,
  ReceiveBooksPanel,
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
  const isMobile = useBreakpointDown("sm");
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
  const [scanError, setScanError] = useState<string | null>(null);
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

  const onScan = async (code: string): Promise<void> => {
    setScanError(null);
    try {
      const result = await receive.mutateAsync({
        input: { submissionId: id, code },
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
    } catch (error) {
      const parsed = transferReceiveErrorOf(error);
      if (parsed.wrongStore !== null) {
        setWrongStore({ code, info: parsed.wrongStore });
        return;
      }
      setScanError(tReceive(`errors.${parsed.reason}`));
    }
  };

  const rows = data?.rows ?? [];
  const isShipped = rows.some((row) => row.shipped);
  const isReviewing = submission?.status === FormSubmissionStatus.Reviewing;
  const modeText = (row: Row) =>
    row.mode === TRANSFER_MODE.whole ? t("modes.whole") : t("modes.partial");
  const ticketsText = (row: Row) => formatTicketRanges(row.ticketNos);

  const groups: ReceiveBookGroup[] = rows.map((row) => ({
    key: row.rowId,
    title: t("receiveRow", {
      game: `${row.gameCode} ${row.gameName}`,
      bookNo: displayBookNo(row.bookNo),
      mode: modeText(row),
      tickets: ticketsText(row),
    }),
    requestedBooks: null,
    receivedBooks: row.received ? 1 : 0,
    rows: [
      {
        rowId: row.rowId,
        bookNo: displayBookNo(row.bookNo),
        lastTicketNo: Number(row.ticketNos.at(-1) ?? 0),
        ticketText: ticketsText(row),
        tickets: row.tickets,
        bookPrice: row.amount,
        rate: row.rate,
        amount: row.purchaseAmount,
        received: row.received,
      },
    ],
  }));

  const columns: TableColumn<Row>[] = [
    {
      key: "game",
      header: t("columns.game"),
      render: (row) => `${row.gameCode} ${row.gameName}`,
    },
    {
      key: "book",
      header: t("columns.book"),
      render: (row) => displayBookNo(row.bookNo),
      isEmphasized: true,
    },
    { key: "mode", header: t("columns.mode"), render: modeText },
    { key: "ticketNos", header: t("columns.ticketNos"), render: ticketsText },
    {
      key: "tickets",
      header: t("columns.tickets"),
      align: "right",
      render: (row) => formatMoney(row.tickets),
    },
    {
      key: "amount",
      header: t("columns.amount"),
      align: "right",
      render: (row) => formatMoney(row.amount),
    },
    {
      key: "rate",
      header: t("columns.rate"),
      align: "right",
      render: (row) => `${String(row.rate)}%`,
    },
    {
      key: "purchaseAmount",
      header: t("columns.purchaseAmount"),
      align: "right",
      render: (row) => formatMoney(row.purchaseAmount),
    },
  ];

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
          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle1" component="h2">
                {t("shipList")}
              </Typography>
              {isMobile ? (
                <Stack spacing={1}>
                  {rows.map((row) => (
                    <Card key={row.rowId} variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {`${row.gameCode} ${row.gameName} · ${displayBookNo(row.bookNo)}`}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {t("cardFacts", {
                          mode: modeText(row),
                          tickets: ticketsText(row),
                          count: row.tickets,
                          rate: row.rate,
                          amount: formatMoney(row.purchaseAmount),
                        })}
                      </Typography>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Table
                  aria-label={t("shipList")}
                  size="small"
                  columns={columns}
                  rows={rows}
                  getRowKey={(row) => row.rowId}
                  minWidth={760}
                  containerSx={{ height: "auto" }}
                />
              )}
            </Stack>
          </Card>
        )}
        {data !== null && rows.length > 0 && isShipped && (
          <ReceiveBooksPanel
            groups={groups}
            canReceive={data.canReceive}
            onScan={onScan}
            thisTimeCount={thisTime.size}
            onComplete={() => {
              showSnackbar(
                "success",
                tReceive("completed", { count: thisTime.size }),
              );
              setThisTime(new Set());
            }}
            isPending={receive.isPending}
            error={scanError}
            columnLabels={{
              lastTicketNo: t("columns.ticketNos"),
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
