import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../store-text";

export interface ReviewFooterProps {
  backfillCount: number;
  backfillAmount: number;
  investigated: number;
  flagged: number;
  unhandled: number;
  canSubmit: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

/** 差異核對底部(Figma ST-14):補登售出、新增待查、標記異常、未處理 + [返回盤點] [送出 →]。 */
export const ReviewFooter = ({
  backfillCount,
  backfillAmount,
  investigated,
  flagged,
  unhandled,
  canSubmit,
  onBack,
  onSubmit,
}: ReviewFooterProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.review");
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={4} sx={{ flexWrap: "wrap" }}>
          <Stack>
            <Typography variant="caption" color="textSecondary">
              {t("summary.backfill")}
            </Typography>
            <Typography variant="subtitle1">
              {t("summary.backfillValue", {
                count: backfillCount,
                amount: moneyText(backfillAmount),
              })}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="caption" color="textSecondary">
              {t("summary.newInvestigate")}
            </Typography>
            <Typography variant="subtitle1">
              {t("summary.count", {
                count: investigated,
              })}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="caption" color="textSecondary">
              {t("summary.flagged")}
            </Typography>
            <Typography variant="subtitle1" sx={{ color: "warning.dark" }}>
              {t("summary.count", {
                count: flagged,
              })}
            </Typography>
          </Stack>
          <Stack>
            <Typography variant="caption" color="textSecondary">
              {t("summary.unhandled")}
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: unhandled > 0 ? "error.main" : "success.dark" }}
            >
              {t("summary.count", { count: unhandled })}
            </Typography>
          </Stack>
        </Stack>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Button variant="text" onClick={onBack}>
            {t("back")}
          </Button>
          <Button variant="contained" disabled={!canSubmit} onClick={onSubmit}>
            {t("submit")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};
