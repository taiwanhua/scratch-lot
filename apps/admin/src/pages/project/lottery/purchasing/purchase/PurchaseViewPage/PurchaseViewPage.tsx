import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type CompleteLotteryPurchaseReceivingMutation,
  type CompleteLotteryPurchaseReceivingMutationVariables,
  FormSubmissionStatus,
  useCompleteLotteryPurchaseReceivingMutation,
  useLotteryPurchaseReceivingQuery,
  useLotterySettlementQuery,
  useNotifyLotteryPurchaseWrongStoreMutation,
  useReceiveLotteryPurchaseBookMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { FormSubmissionDetail } from "@/components/base/form-engine/FormSubmissionDetail/FormSubmissionDetail";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useReceiptPrinter } from "@/components/project/lottery/ReceiptPrint/useReceiptPrinter";
import {
  type ReceiveBookGroup,
  ReceiveBooksPanel,
} from "@/components/project/lottery/ReceiveBooksPanel/ReceiveBooksPanel";
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
import { purchaseReceivingInputOf } from "@/lib/project/lottery/receipts/purchase-receiving-receipt";

import { PURCHASE_MODULE_KEY } from "../purchase-keys";
import { PurchaseReceiptPrint } from "./PurchaseReceiptPrint";
import { PurchaseRedemptionRecords } from "./PurchaseRedemptionRecords";
import { WrongStoreDialog } from "./WrongStoreDialog";
import { type WrongStoreInfo, receiveErrorOf } from "./receive-error";

/**
 * 進貨單的替換檢視頁(專案規格 8.2「頁面」;Figma PU-06 69:651 / 127:26619 / 127:26898、
 * PU-07 127:2714 / 127:26961 / 127:27369、PU-11 127:2993 / 127:26671 / 209:27875):
 * 引擎零件(唯讀)+ 點收區塊 + 勾選的兌獎紀錄(`PurchaseRedemptionRecords`,點一列開兌獎紀錄詳情)+
 * `SettlementPanel` + 審核區塊。
 *
 * - 點收:店長(點收任務在自己手上)逐本刷條碼;「這一次」= 上次 [完成這次點收](或打開這頁)之後點收的本。
 *   [完成這次點收] 結束這一次,自動印進貨點收單兩張(店鋪留存、送貨人留存;規格第 12 章)
 * - 標題列 [列印] / [補印]:進貨點收單(到目前為止已點收的本 + 尚未到的本;補印走底座補印對話框)
 * - 送錯分店:擋下、不入庫,彈窗提示;[知道了] 不記錄,[通知總部更正] 通知那張單的建立者
 * - 結算:送出之後才有(草稿不參與收付);按鈕要 `purchasing.purchase.settle`(api 回的 `canSettle`)
 */
export const PurchaseViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.view");
  const tReceive = useTranslations("admin.lotteryPurchasing.receive");
  const tPages = useTranslations("admin.formEngine.pages");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const access = useFormModuleAccess(PURCHASE_MODULE_KEY);
  const id = routeParam ?? "";
  const { submission } = useFormSubmission(id);
  const serialNo = submission?.serialNo ?? null;
  useRouteTabItemLabel(serialNo);

  const receiving = useLotteryPurchaseReceivingQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "" },
  );
  const data = receiving.data?.lotteryPurchaseReceiving ?? null;
  const [thisTime, setThisTime] = useState<ReadonlySet<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  const [wrongStore, setWrongStore] = useState<{
    code: string;
    info: WrongStoreInfo;
  } | null>(null);

  const receive = useReceiveLotteryPurchaseBookMutation(session.client);
  const printer = useReceiptPrinter();
  const documentUrl = `${globalThis.location.origin}${access.viewRoute ?? ""}/${id}`;
  const notify = useNotifyLotteryPurchaseWrongStoreMutation(session.client);
  // [完成這次點收]:這一次的列標上點收批次(寫入成功後才印這一次的進貨點收單兩張;列印失敗只記 log)
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
        queryClient.setQueryData(
          useLotteryPurchaseReceivingQuery.getKey({ submissionId: id }),
          { lotteryPurchaseReceiving: result.receiving },
        );
        setThisTime(new Set());
        const batch = result.batch ?? null;
        if (submission !== null && batch !== null) {
          void printer.printReceiptAfterCommit(
            "purchase-receiving",
            purchaseReceivingInputOf(
              submission,
              result.receiving,
              batch,
              documentUrl,
            ),
          );
        }
      },
    }),
  );

  const onScan = async (code: string): Promise<void> => {
    setScanError(null);
    try {
      const result = await receive.mutateAsync({
        input: { submissionId: id, code },
      });
      const { rowId } = result.receiveLotteryPurchaseBook;
      setThisTime((current) => new Set([...current, rowId]));
      queryClient.setQueryData(
        useLotteryPurchaseReceivingQuery.getKey({ submissionId: id }),
        {
          lotteryPurchaseReceiving: result.receiveLotteryPurchaseBook.receiving,
        },
      );
    } catch (error) {
      const parsed = receiveErrorOf(error);
      if (parsed.wrongStore !== null) {
        setWrongStore({ code, info: parsed.wrongStore });
        return;
      }
      setScanError(tReceive(`errors.${parsed.reason}`));
    }
  };

  const completeReceiving = () => {
    complete.mutate({ input: { submissionId: id, rowIds: [...thisTime] } });
  };

  const groups: ReceiveBookGroup[] = (data?.groups ?? []).map((group) => ({
    key: group.gameId,
    title: tReceive("groupTitle", {
      code: group.gameCode,
      name: group.gameName,
      price: group.unitPrice,
    }),
    requestedBooks: group.requestedBooks ?? null,
    receivedBooks: group.receivedBooks,
    rows: group.rows.map((row) => ({
      rowId: row.rowId,
      bookNo: row.bookNo.startsWith("0") ? row.bookNo.slice(1) : row.bookNo,
      lastTicketNo: row.lastTicketNo,
      tickets: row.tickets,
      bookPrice: row.bookPrice,
      rate: row.rate,
      amount: row.amount,
      received: row.received,
    })),
  }));
  const remaining =
    data === null ? 0 : Math.max(0, data.totalCount - data.receivedCount);
  const isSubmitted =
    submission !== null && submission.status !== FormSubmissionStatus.Draft;
  // 結算區塊要讀得到收付才顯示(駁回 / 作廢的單不參與收付,api 回錯 → 不顯示)
  const settlement = useLotterySettlementQuery(
    session.client,
    { moduleKey: PURCHASE_MODULE_KEY, refId: id },
    { enabled: isSubmitted, retry: false },
  );

  return (
    <Card sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 2.5 }}>
      <Stack spacing={2.25}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
        >
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
          {submission !== null && data !== null && isSubmitted && (
            <PurchaseReceiptPrint
              submission={submission}
              receiving={data}
              url={documentUrl}
            />
          )}
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
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="h6" component="h1">
            {serialNo === null ? t("title") : t("titleWithNo", { serialNo })}
          </Typography>
          {submission !== null && (
            <SubmissionStatusTag
              status={submission.status}
              blocked={submission.blocked}
            />
          )}
        </Stack>
        {data?.canReceive === true && remaining > 0 && (
          <Alert severity="info">{t("receiveHint", { remaining })}</Alert>
        )}
        <FormSubmissionDetail id={id} />
        {data !== null && data.totalCount > 0 && isSubmitted && (
          <ReceiveBooksPanel
            groups={groups}
            canReceive={data.canReceive}
            onScan={onScan}
            thisTimeCount={thisTime.size}
            onComplete={completeReceiving}
            isPending={receive.isPending}
            error={scanError}
          />
        )}
        {isSubmitted && <PurchaseRedemptionRecords submissionId={id} />}
        {settlement.data !== undefined && (
          <SettlementPanel moduleKey={PURCHASE_MODULE_KEY} refId={id} />
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
    </Card>
  );
};
