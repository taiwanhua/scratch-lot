import { useEffect } from "react";
import { useTranslations } from "use-intl";

import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { DenominationCount } from "@/components/project/lottery/DenominationCount/DenominationCount";
import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";

import type { RedemptionFlow } from "../redemption/useRedemptionFlow";
import { moneyText } from "../store-text";
import { ExpectedCashList } from "./ExpectedCashList";
import { pendingImpactsText, signedMoneyText } from "./checkout-text";
import type { CheckoutWizard, CheckoutWizardData } from "./useCheckoutWizard";

export interface CheckoutDrawerStepProps {
  wizard: CheckoutWizardData;
  flow: CheckoutWizard;
  redemption: RedemptionFlow;
}

/**
 * 交班精靈第 ③ 步 抽屜(規格 6.9;Figma ST-18):左欄應有現金逐項(每筆可點回單據),右欄依面額清點
 * (`DenominationCount`)、實點合計、差額 = 實點 − 應有、差額原因(不為 0 時必填)、審核中的單據自動帶入差額原因。
 */
export const CheckoutDrawerStep = ({
  wizard,
  flow,
  redemption,
}: CheckoutDrawerStepProps) => {
  const t = useTranslations("admin.lotteryStore.checkout");
  const { autoFillPending } = flow;
  useEffect(() => {
    autoFillPending();
    // 只在進到這一步時帶入一次
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoFillPending 每次 render 都是新函式,只在進入這一步時跑一次
  }, []);
  const needReason = flow.difference !== 0;
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", md: "1fr 1.2fr" },
        alignItems: "start",
      }}
    >
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1">
            {t("drawer.expectedTitle")}
          </Typography>
          <ExpectedCashList
            items={wizard.expectedItems}
            expected={wizard.expected}
            onOpenRedemption={redemption.openDetail}
            hint={t("drawer.expectedHint")}
          />
        </Stack>
      </Card>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1">
            {t("drawer.countedTitle")}
          </Typography>
          <DenominationCount
            rows={flow.denominations}
            onChange={flow.setCount}
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
          <Stack
            direction="row"
            sx={{ justifyContent: "space-between", alignItems: "baseline" }}
          >
            <Typography variant="body2" color="text.secondary">
              {t("drawer.difference")}
            </Typography>
            <Typography
              variant="h6"
              color={flow.difference === 0 ? "text.primary" : "error.main"}
            >
              {signedMoneyText(flow.difference)}
            </Typography>
          </Stack>
          {needReason ? (
            <ReasonFields
              categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.checkoutDiffReason}
              label={t("drawer.diffReason")}
              value={flow.diffReason}
              onChange={flow.setDiffReason}
              invalid={[]}
            />
          ) : null}
          {wizard.pendingImpacts.length > 0 ? (
            <Alert severity="warning">
              {t("drawer.pending", {
                items: pendingImpactsText(t, wizard.pendingImpacts),
              })}
            </Alert>
          ) : null}
        </Stack>
      </Card>
    </Box>
  );
};
