import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { FormSubmissionStatus, useLotterySettlementQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { FormSubmissionDetail } from "@/components/base/form-engine/FormSubmissionDetail/FormSubmissionDetail";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { SettlementPanel } from "@/components/project/lottery/SettlementPanel/SettlementPanel";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { SubmissionDeleteButton } from "../../shared/SubmissionDeleteButton";
import { PURCHASE_MODULE_KEY } from "../purchase-keys";
import { PurchaseReceiptPrint } from "./PurchaseReceiptPrint";
import { PurchaseReceiveHint } from "./PurchaseReceiveHint";
import { PurchaseReceivingSection } from "./PurchaseReceivingSection";
import { PurchaseRedemptionRecords } from "./PurchaseRedemptionRecords";
import { usePurchaseReceiving } from "./usePurchaseReceiving";

/**
 * 進貨單的替換檢視頁(專案規格 8.2「頁面」;Figma PU-06 69:651 / 127:26619 / 127:26898、
 * PU-07 127:2714 / 127:26961 / 127:27369、PU-11 127:2993 / 127:26671 / 209:27875):
 * 引擎零件(唯讀)+ 點收區塊 + 勾選的兌獎紀錄(`PurchaseRedemptionRecords`,點一列開兌獎紀錄詳情)+
 * `SettlementPanel` + 審核區塊。
 *
 * - 點收:`PurchaseReceivingSection`(申請中心詳情頁也登記同一個區塊,`PurchaseApplyCenterSection`):
 *   店長(點收任務在自己手上)逐本刷條碼、[完成這次點收] 自動印進貨點收單兩張、送錯分店彈窗
 * - 標題列 [列印] / [補印]:進貨點收單(到目前為止已點收的本 + 尚未到的本;補印走底座補印對話框)
 * - 結算:送出之後才有(草稿不參與收付);按鈕要 `purchasing.purchase.settle`(api 回的 `canSettle`)
 */
export const PurchaseViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.view");
  const tPages = useTranslations("admin.formEngine.pages");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const { session } = useSession();
  const access = useFormModuleAccess(PURCHASE_MODULE_KEY);
  const id = routeParam ?? "";
  const { submission } = useFormSubmission(id);
  const serialNo = submission?.serialNo ?? null;
  useRouteTabItemLabel(serialNo);
  const data = usePurchaseReceiving(id);
  // 單據 QR 連到檢視頁:路由依模組樹(`lotteryReceiptLinks`),不依操作者自己的頁面權限;讀到之前不顯示 [列印]
  const { links } = useReceiptLinks();
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
          {submission !== null &&
            data !== null &&
            links !== null &&
            isSubmitted && (
              <PurchaseReceiptPrint
                submission={submission}
                receiving={data}
                url={links.purchaseViewUrl(id)}
              />
            )}
          {submission !== null && (
            <SubmissionDeleteButton
              moduleKey={PURCHASE_MODULE_KEY}
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
        <PurchaseReceiveHint submissionId={id} />
        <FormSubmissionDetail id={id} />
        {submission !== null && (
          <PurchaseReceivingSection submission={submission} />
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
    </Card>
  );
};
