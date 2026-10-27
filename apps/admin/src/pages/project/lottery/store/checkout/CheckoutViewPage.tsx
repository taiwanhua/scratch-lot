import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { CHECKOUT_TYPE, STORE_KEY } from "@repo/domain/project/lottery";
import {
  type LotteryCheckoutQuery,
  useLotteryCheckoutQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { DenominationCount } from "@/components/project/lottery/DenominationCount/DenominationCount";
import { ReceiptPrintButton } from "@/components/project/lottery/ReceiptPrint/ReceiptPrintButton";
import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { DailyCloseSheet } from "../daily-close/DailyCloseSheet";
import { useRedemptionFlow } from "../redemption/useRedemptionFlow";
import { moneyText } from "../store-text";
import { ExpectedCashList } from "./ExpectedCashList";
import { pendingImpactsText, signedMoneyText } from "./checkout-text";
import { useCheckoutReceipt } from "./useCheckoutReceipt";

type Detail = LotteryCheckoutQuery["lotteryCheckout"];

/** 頁首的 [列印] / [補印](交班 → 交班結帳單、日結 → 日結單);結帳單還沒讀到不出現。 */
const CheckoutPrintButton = ({
  detail,
  serialNo,
}: {
  detail: Detail | null;
  serialNo: string | null;
}) => {
  const receiptOf = useCheckoutReceipt();
  const { links } = useReceiptLinks();
  if (detail === null) {
    return null;
  }
  const receipt = receiptOf(detail, serialNo, links);
  return receipt.kind === "store-daily-close" ? (
    <ReceiptPrintButton kind="store-daily-close" payload={receipt.payload} />
  ) : (
    <ReceiptPrintButton kind="store-shift-checkout" payload={receipt.payload} />
  );
};

/** 頁首標題:「結帳確認申請 · 日結 C-0043」;單號 / 結帳單還沒讀到 =「結帳確認申請」。 */
const titleOf = (
  t: (key: string, values?: Record<string, string | number>) => string,
  serialNo: string | null,
  detail: Detail | null,
): string =>
  serialNo === null || detail === null
    ? t("view.title")
    : t("view.titleWithNo", { type: t(`types.${detail.type}`), serialNo });

/** 盤點方式的文字(跳過 / 沿用 / 現在盤點;交班與日結的檢視頁共用)。 */
const stocktakeTextOf = (
  t: (key: string, values?: Record<string, string | number>) => string,
  temporal: (value: string, format: "monthDayTime") => string,
  item: Detail,
): string => {
  if (item.stocktakeMode === "skip") {
    return t("view.stocktakeSkipped", { reason: item.skipReason ?? "" });
  }
  const stocktake = item.stocktake ?? null;
  if (stocktake === null) {
    return "—";
  }
  const time = temporal(stocktake.startedAt, "monthDayTime");
  return item.stocktakeMode === "reuse"
    ? t("view.stocktakeReuse", {
        time,
        scope: stocktake.scopeName ?? t("stocktake.wholeStore"),
        serial: stocktake.serialNo ?? "",
      })
    : t("view.stocktakeNew", { time });
};

/**
 * 結帳確認申請的檢視頁(規格 8.7;Figma ST-28a 交班 / ST-28b 日結;替換表單引擎的檢視頁):頁首(類型、單號、狀態、
 * 申請人、送出時間)、結帳單(交班:收銀點、盤點、應有現金逐項可點回單據、實點、差額與原因、留給下一班 / 接班人;
 * 日結:`DailyCloseSheet` 涵蓋計算期間與班、全店盤點、小金庫逐項、存入銀行)、依面額清點(唯讀)+ 審核。
 * 退回後申請人 [修改後再送出] 打開精靈(帶入原內容)。頁首 [列印] / [補印] 印交班結帳單 / 日結單
 * (規格第 12 章;和送出時自動印的同一份版面,補印標示「補印」與次數;沒有 `api.printing.print` 不出現)。
 */
export const CheckoutViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryStore.checkout");
  const { session } = useSession();
  const temporal = useTemporalText();
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const access = useFormModuleAccess(STORE_KEY);
  const redemption = useRedemptionFlow();
  const id = routeParam ?? "";
  const { submission } = useFormSubmission(id);
  const query = useLotteryCheckoutQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "", retry: false },
  );
  const serialNo = submission?.serialNo ?? null;
  useRouteTabItemLabel(serialNo ?? t("view.title"));
  const detail = query.data?.lotteryCheckout ?? null;

  const stocktakeText = (item: Detail): string =>
    stocktakeTextOf(t, temporal, item);

  if (query.isError) {
    return <Alert severity="error">{t("view.loadFailed")}</Alert>;
  }
  const facts: [string, string, boolean][] =
    detail === null
      ? []
      : [
          [t("view.cashPoint"), detail.cashPoint?.name ?? "—", false],
          [t("view.stocktake"), stocktakeText(detail), false],
          [t("view.expected"), moneyText(detail.expected), true],
          [t("view.counted"), moneyText(detail.counted), true],
          [
            t("view.difference"),
            detail.difference === 0
              ? "0"
              : `${signedMoneyText(detail.difference)} · ${detail.diffReason ?? ""}`,
            true,
          ],
          [
            t("view.handover"),
            `${moneyText(detail.leftForNext)} / ${detail.successor?.name ?? t("view.noSuccessor")}`,
            false,
          ],
        ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {/* 檢視頁的頂部列(REACT-16):左 [← 返回列表],右 [修改後再送出] */}
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1.5, flexShrink: 0 }}
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
          {t("view.backToList")}
        </Button>
        <Box sx={{ flex: 1 }} />
        {access.editRoute !== null && submission?.abilities.canEdit === true ? (
          <Button
            onClick={() => {
              void navigate(`${access.editRoute ?? ""}/${id}`);
            }}
          >
            {t("view.edit")}
          </Button>
        ) : null}
      </Stack>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5, flexShrink: 0 }}>
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="h6" component="h1">
              {titleOf(t, serialNo, detail)}
            </Typography>
            {submission === null ? null : (
              <SubmissionStatusTag
                status={submission.status}
                blocked={submission.blocked}
              />
            )}
            <Box sx={{ flex: 1 }} />
            <CheckoutPrintButton detail={detail} serialNo={serialNo} />
          </Stack>
          {detail === null ? null : (
            <Typography variant="body2" color="textSecondary">
              {t("view.meta", {
                name: detail.submittedBy?.name ?? "",
                time: temporal(detail.submittedAt, "monthDayTime"),
              })}
            </Typography>
          )}
        </Stack>
      </Card>
      {detail === null ? null : (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "1.2fr 1fr" },
            alignItems: "start",
            flexShrink: 0,
          }}
        >
          <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
            {detail.type === CHECKOUT_TYPE.daily ? (
              <DailyCloseSheet
                detail={detail}
                stocktakeText={stocktakeText(detail)}
              />
            ) : (
              <Stack spacing={1.5}>
                <Typography variant="subtitle1">
                  {t("view.sheetTitle")}
                </Typography>
                <Stack spacing={0.5}>
                  {facts.slice(0, 2).map(([label, value]) => (
                    <Stack
                      key={label}
                      direction="row"
                      sx={{ justifyContent: "space-between", gap: 2 }}
                    >
                      <Typography variant="body2" color="textSecondary">
                        {label}
                      </Typography>
                      <Typography variant="body1" sx={{ textAlign: "right" }}>
                        {value}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
                <ExpectedCashList
                  items={detail.expectedItems}
                  expected={detail.expected}
                  onOpenRedemption={redemption.openDetail}
                  hint={null}
                />
                <Stack spacing={0.5}>
                  {facts.slice(3).map(([label, value, strong]) => (
                    <Stack
                      key={label}
                      direction="row"
                      sx={{ justifyContent: "space-between", gap: 2 }}
                    >
                      <Typography variant="body2" color="textSecondary">
                        {label}
                      </Typography>
                      <Typography
                        variant={strong ? "subtitle1" : "body1"}
                        color={
                          label === t("view.difference") &&
                          detail.difference !== 0
                            ? "error"
                            : "textPrimary"
                        }
                        sx={{ textAlign: "right" }}
                      >
                        {value}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
                {detail.pendingImpacts.length > 0 ? (
                  <Alert severity="warning">
                    {t("view.pending", {
                      items: pendingImpactsText(t, detail.pendingImpacts),
                    })}
                  </Alert>
                ) : null}
                <Typography variant="caption" color="textSecondary">
                  {t("view.hint")}
                </Typography>
              </Stack>
            )}
          </Card>
          <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
            <DenominationCount
              rows={detail.denominations}
              labels={{
                value: t("drawer.columns.value"),
                count: t("drawer.columns.count"),
                subtotal: t("drawer.columns.subtotal"),
                total: t("drawer.countedTotal"),
                countAria: (value) =>
                  `${t("drawer.columns.count")} ${moneyText(value)}`,
              }}
              moneyText={moneyText}
            />
          </Card>
        </Box>
      )}
      {submission?.currentInstanceId == null ? null : (
        <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5, flexShrink: 0 }}>
          <ApprovalSection
            instanceId={submission.currentInstanceId}
            submission={submission}
            onCopied={(copiedId) => {
              if (access.editRoute !== null) {
                void navigate(`${access.editRoute}/${copiedId}`);
              }
            }}
          />
        </Card>
      )}
      {redemption.element}
    </Stack>
  );
};
