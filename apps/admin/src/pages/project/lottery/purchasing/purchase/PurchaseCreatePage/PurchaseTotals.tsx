import { useTranslations } from "use-intl";

import type { PurchaseRedemptionTotals } from "@repo/domain/project/lottery";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { formatMoney } from "../purchase-keys";

export interface PurchaseTotalsProps {
  purchaseTotal: number;
  totals: PurchaseRedemptionTotals;
  /** 勾了幾筆兌獎紀錄 */
  pickedCount: number;
}

/**
 * 進貨單新增頁的合計(規格 8.2「合計」;Figma PU-05):批購合計、兌獎金額(勾選 N 筆)、兌獎折抵、
 * 扣款金額(粗體;這張單的應付)、兌獎剩餘。算法在 `purchaseRedemptionTotalsOf`(表單的計算欄同一套)。
 */
export const PurchaseTotals = ({
  purchaseTotal,
  totals,
  pickedCount,
}: PurchaseTotalsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase");
  const rows = [
    {
      key: "purchase",
      label: t("create.purchaseTotal"),
      amount: purchaseTotal,
    },
    {
      key: "redemption",
      label: t("redemption.totals.redemption", { count: pickedCount }),
      amount: totals.redemptionTotal,
    },
    {
      key: "offset",
      label: t("redemption.totals.offset"),
      amount: totals.offset,
    },
    {
      key: "deducted",
      label: t("create.deductedAmount"),
      amount: totals.deducted,
    },
    {
      key: "remainder",
      label: t("redemption.totals.remainder"),
      amount: totals.remainder,
    },
  ];
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1}>
        {rows.map((row) => {
          const fontWeight = row.key === "deducted" ? 700 : 400;
          return (
            <Stack key={row.key} direction="row">
              <Typography variant="body2" sx={{ flex: 1, fontWeight }}>
                {row.label}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight }}>
                {formatMoney(row.amount)}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Card>
  );
};
