import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  FormSubmissionStatus,
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

import { PURCHASE_MODULE_KEY } from "../purchase-keys";
import { WrongStoreDialog } from "./WrongStoreDialog";
import { type WrongStoreInfo, receiveErrorOf } from "./receive-error";

/**
 * 進貨單的替換檢視頁(專案規格 8.2「頁面」;Figma PU-06 69:651 / 127:26619 / 127:26898、
 * PU-07 127:2714 / 127:26961 / 127:27369、PU-11 127:2993 / 127:26671 / 209:27875):
 * 引擎零件(唯讀)+ 點收區塊 + `SettlementPanel` + 審核區塊。
 *
 * - 點收:店長(點收任務在自己手上)逐本刷條碼;「這一次」= 上次 [完成這次點收](或打開這頁)之後點收的本。
 *   [完成這次點收] 結束這一次(進貨點收單的列印由 58mm 的功能接在 `completeReceiving`)
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

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: useLotteryPurchaseReceivingQuery.getKey({ submissionId: id }),
    });
  };
  const receive = useReceiveLotteryPurchaseBookMutation(session.client);
  const notify = useNotifyLotteryPurchaseWrongStoreMutation(session.client);

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

  /** [完成這次點收]:結束這一次(不寫資料;列印由 58mm 的功能接在這裡)。 */
  const completeReceiving = () => {
    showSnackbar("success", tReceive("completed", { count: thisTime.size }));
    setThisTime(new Set());
    refresh();
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
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
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
