import { useTranslations } from "use-intl";

import { STORE_PERMISSIONS } from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import type { RedemptionFlow } from "../redemption/useRedemptionFlow";
import { moneyText } from "../store-text";
import type { CheckoutWizardData } from "./useCheckoutWizard";

export interface CheckoutRedemptionStepProps {
  wizard: CheckoutWizardData;
  redemption: RedemptionFlow;
}

/**
 * 交班精靈第 ② 步 兌獎(規格 6.9;Figma ST-17b):這一班的兌獎逐筆(時間、刮刮樂、金額)、合計、[補登兌獎]
 * (立即生效,和看板上的兌獎相同;之後取消精靈也不會退回);點一列開兌獎紀錄詳情。
 */
export const CheckoutRedemptionStep = ({
  wizard,
  redemption,
}: CheckoutRedemptionStepProps) => {
  const t = useTranslations("admin.lotteryStore.checkout.redemption");
  const temporal = useTemporalText();
  const { hasPermission } = usePermissions();
  const expected = wizard.expected;
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            {t("title", { count: wizard.redemptions.length })}
          </Typography>
          {hasPermission(STORE_PERMISSIONS.redeem) ? (
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                redemption.openRedeem({
                  orgId: wizard.shift.orgId,
                  shiftId: wizard.shift.id,
                  cashPointName: wizard.shift.cashPoint.name,
                  expectedCash: expected,
                });
              }}
            >
              {t("backfill")}
            </Button>
          ) : null}
          <Typography variant="caption" color="textSecondary">
            {t("immediate")}
          </Typography>
        </Stack>
        {wizard.redemptions.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            {t("empty")}
          </Typography>
        ) : (
          <Stack component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {wizard.redemptions.map((row) => (
              <Box
                key={row.id}
                component="li"
                role="button"
                tabIndex={0}
                aria-label={t("rowAria", {
                  ticket: row.ticketLabel,
                  amount: moneyText(row.prizeAmount),
                })}
                onClick={() => {
                  redemption.openDetail(row.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    redemption.openDetail(row.id);
                  }
                }}
                sx={{
                  display: "flex",
                  gap: 2,
                  py: 1,
                  cursor: "pointer",
                  borderBottom: 1,
                  borderColor: "divider",
                }}
              >
                <Typography variant="body2" color="textSecondary">
                  {temporal(row.redeemedAt, "monthDayTime").split(" ").at(-1)}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {row.ticketLabel}
                </Typography>
                <Typography variant="body1">
                  {moneyText(row.prizeAmount)}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="body2" color="textSecondary">
            {t("total")}
          </Typography>
          <Typography variant="subtitle1">
            {moneyText(wizard.redemptionTotal)}
          </Typography>
        </Stack>
        <Typography variant="caption" color="textSecondary">
          {t("hint")}
        </Typography>
      </Stack>
    </Card>
  );
};
