import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  FormSubmissionStatus,
  useLotteryWholesaleDetailQuery,
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
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { SubmissionDeleteButton } from "../../shared/SubmissionDeleteButton";
import { WHOLESALE_MODULE_KEY, formatMoney } from "../wholesale-keys";
import { WholesaleBooksSection } from "./WholesaleBooksSection";
import { WholesalePrintButtons } from "./WholesalePrintButtons";
import { WholesaleSettlementSection } from "./WholesaleSettlementSection";

/** 標頭第一列(返回、列印、刪除、編輯):窄螢幕時換行。 */
const HEADER_ROW_SX = { alignItems: "center", flexWrap: "wrap", rowGap: 1 };

/**
 * 批售單的替換檢視頁(規格 21.3「檢視頁」;Figma WS-03a 917:9440 / 922:11590 / 922:12578、WS-03c、WS-03d):
 *
 * - 標頭:單號、狀態(審核中 = 出貨確認)、出貨分店 → 批售客戶、本數、收款方式(從帳戶入帳另寫帳戶)、批售金額、備註
 * - 本清單(審核中 = 批售中、已完成 = 已批售)
 * - 結算區塊(`WholesaleSettlementSection`)+ 審核區塊(核准 / 退回 / 駁回 / 作廢沿用引擎)
 * - 列印(規格 21.8):標頭 [列印] / [補印](`WholesalePrintButtons`:批售出貨單、批售收款收據);
 *   核准完成後的自動列印是批售單的審核擴充(`WholesaleShipmentEffect`),[收款] 收現金後的自動列印在結算區塊
 *
 * 兩個區塊申請中心詳情頁也用(`WholesaleApplyCenterSection`)。
 */
export const WholesaleViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.view");
  const tModes = useTranslations(
    "admin.lotteryPurchasing.wholesale.paymentModes",
  );
  const tPages = useTranslations("admin.formEngine.pages");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const { session } = useSession();
  const access = useFormModuleAccess(WHOLESALE_MODULE_KEY);
  const id = routeParam ?? "";
  const { submission } = useFormSubmission(id);
  const serialNo = submission?.serialNo ?? null;
  useRouteTabItemLabel(serialNo);
  const query = useLotteryWholesaleDetailQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "" },
  );
  const detail = query.data?.lotteryWholesaleDetail ?? null;
  const note = submission?.values.note;
  const modeText = (mode: string, accountLabel: string | null) =>
    accountLabel === null
      ? t("paymentMode", { mode: tModes(mode) })
      : t("paymentModeWithAccount", {
          mode: tModes(mode),
          account: accountLabel,
        });

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
              {submission !== null && detail !== null && (
                <WholesalePrintButtons
                  submission={submission}
                  detail={detail}
                />
              )}
              {submission !== null && (
                <SubmissionDeleteButton
                  moduleKey={WHOLESALE_MODULE_KEY}
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
              {submission?.status === FormSubmissionStatus.Reviewing ? (
                <Tag tone="warning" label={t("stageShip")} />
              ) : (
                submission !== null && (
                  <SubmissionStatusTag
                    status={submission.status}
                    blocked={submission.blocked}
                  />
                )
              )}
            </Stack>
            {detail !== null && (
              <Typography variant="body2" color="textSecondary">
                {[
                  `${detail.fromBranchName} → ${detail.customerName}`,
                  t("books", { count: detail.rows.length }),
                  detail.paymentMode == null
                    ? null
                    : modeText(detail.paymentMode, detail.accountLabel ?? null),
                  t("amount", { amount: formatMoney(detail.amount) }),
                  typeof note === "string" && note !== ""
                    ? t("note", { note })
                    : null,
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </Typography>
            )}
          </Stack>
        </Card>
        {submission !== null && detail !== null && (
          <>
            <WholesaleBooksSection status={submission.status} detail={detail} />
            <WholesaleSettlementSection
              submission={submission}
              detail={detail}
            />
          </>
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
