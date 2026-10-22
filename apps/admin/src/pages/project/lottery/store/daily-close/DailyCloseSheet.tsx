import { useTranslations } from "use-intl";

import type { LotteryCheckoutQuery } from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { ExpectedCashList } from "../checkout/ExpectedCashList";
import { signedMoneyText } from "../checkout/checkout-text";
import { moneyText } from "../store-text";

type Detail = LotteryCheckoutQuery["lotteryCheckout"];

export interface DailyCloseSheetProps {
  detail: Detail;
  /** 全店盤點的文字(沿用 / 現在盤點 / 跳過;檢視頁算好傳入) */
  stocktakeText: string;
}

/**
 * 日結的結帳單(結帳確認申請檢視頁的日結版;規格 8.7;Figma ST-28b):類型、涵蓋計算期間、涵蓋計算的班(單號)、
 * 全店盤點、小金庫應有逐項(每一項可點開原本的單據)、實點、差額與原因、存入銀行、存入後小金庫。
 */
export const DailyCloseSheet = ({
  detail,
  stocktakeText,
}: DailyCloseSheetProps) => {
  const t = useTranslations("admin.lotteryStore");
  const temporal = useTemporalText();
  const time = (value: string | null | undefined) =>
    value == null ? null : temporal(value, "monthDayTime");
  const serials = detail.coveredShifts
    .map((row) => row.serialNo ?? "")
    .filter((serial) => serial !== "");
  const facts: [string, string][] = [
    [t("checkout.view.type"), t("checkout.types.daily")],
    [
      t("dailyClose.view.period"),
      t("dailyClose.confirm.periodValue", {
        from: time(detail.coveredFrom) ?? t("dailyClose.confirm.firstClose"),
        to: time(detail.coveredTo) ?? "",
      }),
    ],
    [
      t("dailyClose.view.shifts"),
      t("dailyClose.view.shiftsValue", {
        count: detail.coveredShifts.length,
        serials: serials.join("、"),
      }),
    ],
    [t("dailyClose.view.stocktake"), stocktakeText],
  ];
  const after = detail.counted - detail.bankDepositAmount;
  const tail: [string, string, boolean][] = [
    [t("checkout.view.counted"), moneyText(detail.counted), false],
    [
      t("checkout.view.difference"),
      detail.difference === 0
        ? "0"
        : `${signedMoneyText(detail.difference)} · ${detail.diffReason ?? ""}`,
      detail.difference !== 0,
    ],
    [
      t("dailyClose.view.bankDeposit"),
      detail.bankDepositAmount > 0
        ? `${moneyText(detail.bankDepositAmount)} → ${detail.bankAccount?.name ?? ""}`
        : t("dailyClose.confirm.noDeposit"),
      false,
    ],
    [t("dailyClose.view.after"), moneyText(after), false],
  ];
  const row = (label: string, value: string, warn = false) => (
    <Stack
      key={label}
      direction="row"
      sx={{ justifyContent: "space-between", gap: 2 }}
    >
      <Typography variant="body2" color="textSecondary">
        {label}
      </Typography>
      <Typography
        variant="body1"
        color={warn ? "error" : "textPrimary"}
        sx={{ textAlign: "right" }}
      >
        {value}
      </Typography>
    </Stack>
  );
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1">
        {t("checkout.view.sheetTitle")}
      </Typography>
      <Stack spacing={0.5}>
        {facts.map(([label, value]) => row(label, value))}
      </Stack>
      <ExpectedCashList
        items={detail.expectedItems}
        expected={detail.expected}
        totalLabel={t("dailyClose.vault.expectedTitle")}
        labelOf={(item) =>
          item.kind === "opening"
            ? t("dailyClose.view.opening")
            : t(`dailyClose.vault.items.${item.kind}`)
        }
      />
      <Stack spacing={0.5}>
        {tail.map(([label, value, warn]) => row(label, value, warn))}
      </Stack>
      <Typography variant="caption" color="textSecondary">
        {t("checkout.view.hint")}
      </Typography>
    </Stack>
  );
};
