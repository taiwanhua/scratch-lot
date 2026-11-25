import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { formatMoney } from "../wholesale-keys";

export interface WholesaleTotalsProps {
  books: number;
  amount: number;
  /** 原成本與預估獲利;沒有 `inventory.show-cost`(或還沒有本)= null,不顯示 */
  profit: { cost: number; profit: number } | null;
}

/**
 * 批售單新增頁的合計(規格 21.3;Figma WS-02a / WS-02c):共 N 本、批售金額;看得到成本的人另有原成本與預估獲利,
 * 預估獲利 ≤ 0 時警告(只提示不擋)。
 */
export const WholesaleTotals = ({
  books,
  amount,
  profit,
}: WholesaleTotalsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.create.totals");
  const rows = [
    {
      key: "books",
      label: t("books"),
      value: t("bookCount", { count: books }),
    },
    { key: "amount", label: t("amount"), value: formatMoney(amount) },
    ...(profit === null
      ? []
      : [
          { key: "cost", label: t("cost"), value: formatMoney(profit.cost) },
          {
            key: "profit",
            label: t("profit"),
            value: formatMoney(profit.profit),
          },
        ]),
  ];
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1}>
        {rows.map((row) => (
          <Stack key={row.key} direction="row">
            <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
              {row.label}
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontWeight: row.key === "amount" ? 700 : 400 }}
            >
              {row.value}
            </Typography>
          </Stack>
        ))}
        {profit !== null && profit.profit <= 0 && (
          <Alert severity="warning">{t("noProfit")}</Alert>
        )}
      </Stack>
    </Card>
  );
};
