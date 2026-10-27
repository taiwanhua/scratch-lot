import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  FormSubmissionStatus,
  useLotterySettlementQuery,
  useLotteryTransferReceivingQuery,
} from "@repo/graphql";
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
} from "@/components/project/lottery/BookGroupList/BookGroupList";
import { useBookProgressLabel } from "@/components/project/lottery/BookGroupList/useBookProgressLabel";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { SubmissionDeleteButton } from "../../shared/SubmissionDeleteButton";
import { TRANSFER_MODULE_KEY, formatMoney } from "../transfer-keys";
import { TransferPrintButtons } from "./TransferPrintButtons";
import { TransferReceivingSection } from "./TransferReceivingSection";
import { TransferSettlementSection } from "./TransferSettlementSection";
import { useTransferBookGroups } from "./useTransferBookGroups";
import { useTransferReceipts } from "./useTransferReceipts";

/** 標頭第一列(返回、列印、編輯):窄螢幕時換行。 */
const HEADER_ROW_SX = { alignItems: "center", flexWrap: "wrap", rowGap: 1 };

/**
 * 調貨單的替換檢視頁(專案規格 8.4「頁面」;Figma PU-10a 出貨確認 92:2768 / 573:111230 / 573:111385、
 * PU-10b 點收與結算 127:26050 / 127:27289 / 127:27667):
 *
 * - 標頭:單號、關卡標籤(第一關出貨確認 / 第二關點收)、出貨店 → 收貨店、叫貨單、建立者
 * - 第一關(還沒出貨):出貨確認清單(遊戲、本、方式、張號、張數、金額、批購金額率、批購金額)
 * - 出貨之後:點收區塊 `TransferReceivingSection`(與進貨單共用 `ReceiveBooksPanel`;申請中心詳情頁也登記同一個
 *   區塊,`TransferApplyCenterSection`)。整本的列刷一張整列點收;選張的列逐張點收(刷背面編號 → 那一列展開、
 *   捲到並閃一下;展開格子點選 → [點收選取的 N 張];[其餘全部到齊…] 確認後點收剩下的張;`TransferRowTickets`)。
 *   列顯示「未點收 0 / 10」「部分點收 9 / 12」「已點收」,點收過一部分還有張沒到時提示哪幾張
 * - 結算區塊 `TransferSettlementSection`(兩邊店的收付;按鈕依 `pay` / `receive` 與分店)+ 核准前三個數字不相等的提示
 *   (申請中心詳情頁也登記同一個區塊)+ 審核區塊
 * - 送錯分店:擋下、不入庫,彈窗提示這本屬於哪一家店的哪一張調貨單(點收區塊裡)
 * - 列印(規格第 12 章):標頭 [列印](`useTransferReceipts`);第一關通過後的自動列印是調貨單的審核擴充(`TransferShipmentEffect`);
 *   收貨店 [完成這次點收] 寫入成功後自動印這一次的調貨點收單(兩聯,一個列印工作)
 */
export const TransferViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.view");
  const tPages = useTranslations("admin.formEngine.pages");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
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
  // 出貨確認清單(點收區塊另外畫同一份清單 + 點收狀態)
  const { groups } = useTransferBookGroups(submission, rows);
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
              {submission !== null && (
                <SubmissionDeleteButton
                  moduleKey={TRANSFER_MODULE_KEY}
                  id={id}
                  label={submission.serialNo ?? submission.formName ?? id}
                  status={submission.status}
                  canDelete={submission.abilities.canDelete}
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
        {submission !== null && (
          <TransferReceivingSection submission={submission} />
        )}
        {submission !== null && (
          <TransferSettlementSection submission={submission} />
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
    </Box>
  );
};
