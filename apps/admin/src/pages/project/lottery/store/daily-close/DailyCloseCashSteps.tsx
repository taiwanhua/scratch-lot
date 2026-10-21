import { useTranslations } from "use-intl";

import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { DenominationCount } from "@/components/project/lottery/DenominationCount/DenominationCount";
import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { ExpectedCashList } from "../checkout/ExpectedCashList";
import { signedMoneyText } from "../checkout/checkout-text";
import { moneyText } from "../store-text";
import type {
  DailyCloseWizard,
  DailyCloseWizardData,
} from "./useDailyCloseWizard";

export interface DailyCloseCashStepProps {
  wizard: DailyCloseWizardData;
  flow: DailyCloseWizard;
}

/** 「10/14 09:02」:涵蓋計算期間 / 小金庫起算點的寫法。 */
const useShortTime = () => {
  const temporal = useTemporalText();
  return (value: string | null | undefined) =>
    value == null ? null : temporal(value, "monthDayTime");
};

/** 一列「標籤 … 值」。 */
const Fact = ({
  label,
  value,
  tone = "text.primary",
}: {
  label: string;
  value: string;
  tone?: string;
}) => (
  <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body1" color={tone} sx={{ textAlign: "right" }}>
      {value}
    </Typography>
  </Stack>
);

/**
 * 日結第 ③ 步 小金庫(規格 6.10;Figma ST-24):左欄小金庫應有逐項(期初 = 上次日結清點 + 投庫 − 出庫 ± 調貨
 * ± 現金更正 − 存銀行;每筆可點回即時現金帳),右欄依面額清點、差額 = 實點 − 應有、差額原因(不為 0 時必填)。
 */
export const DailyCloseVaultStep = ({
  wizard,
  flow,
}: DailyCloseCashStepProps) => {
  const t = useTranslations("admin.lotteryStore");
  const temporal = useTemporalText();
  const baselineAt = wizard.vaultBaselineAt ?? null;
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
            {t("dailyClose.vault.expectedTitle")}
          </Typography>
          <ExpectedCashList
            items={wizard.vaultItems}
            expected={wizard.vaultExpected}
            totalLabel={t("dailyClose.vault.expectedTitle")}
            labelOf={(item) => {
              if (item.kind === "opening") {
                return baselineAt === null
                  ? t("dailyClose.vault.openingNone")
                  : t("dailyClose.vault.opening", {
                      date: temporal(baselineAt, "monthDay"),
                    });
              }
              return t(`dailyClose.vault.items.${item.kind}`);
            }}
            hint={t("checkout.drawer.expectedHint")}
          />
        </Stack>
      </Card>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1">
            {t("checkout.drawer.countedTitle")}
          </Typography>
          <DenominationCount
            rows={flow.denominations}
            onChange={flow.setCount}
            labels={{
              value: t("checkout.drawer.columns.value"),
              count: t("checkout.drawer.columns.count"),
              subtotal: t("checkout.drawer.columns.subtotal"),
              total: t("checkout.drawer.countedTotal"),
              countAria: (value) =>
                `${t("checkout.drawer.columns.count")} ${moneyText(value)}`,
            }}
            moneyText={moneyText}
          />
          <Stack
            direction="row"
            sx={{ justifyContent: "space-between", alignItems: "baseline" }}
          >
            <Typography variant="body2" color="text.secondary">
              {t("checkout.drawer.difference")}
            </Typography>
            <Typography
              variant="h6"
              color={flow.difference === 0 ? "success.main" : "error.main"}
            >
              {signedMoneyText(flow.difference)}
            </Typography>
          </Stack>
          {flow.difference === 0 ? null : (
            <ReasonFields
              categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.checkoutDiffReason}
              label={t("checkout.drawer.diffReason")}
              value={flow.diffReason}
              onChange={flow.setDiffReason}
              invalid={[]}
            />
          )}
        </Stack>
      </Card>
    </Box>
  );
};

/**
 * 日結第 ④ 步 存入銀行(規格 6.10、6.11;Figma ST-25a):金額(0 = 不存;不能超過小金庫實點)、存入帳戶
 * (使用中、使用組織包含這家分店;只有一個時自動帶入)、存入後小金庫應有。核准完成時才寫「存銀行」流水與銀行「存入」。
 */
export const DailyCloseBankStep = ({
  wizard,
  flow,
}: DailyCloseCashStepProps) => {
  const t = useTranslations("admin.lotteryStore.dailyClose.bank");
  const tStore = useTranslations("admin.lotteryStore");
  const noAccount = wizard.bankAccounts.length === 0;
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Stack spacing={2} sx={{ maxWidth: 640 }}>
        <Typography variant="subtitle1">{t("title")}</Typography>
        {noAccount ? (
          <Alert severity="warning">
            {tStore("errors.BANK_DEPOSIT_NO_ACCOUNT")}
          </Alert>
        ) : null}
        <TextField
          label={t("amount")}
          value={flow.depositAmount}
          error={
            flow.depositProblem === "invalid_amount" ||
            flow.depositProblem === "exceeds_available"
          }
          helperText={
            flow.depositProblem === "exceeds_available"
              ? t("exceeds", { amount: moneyText(flow.counted) })
              : undefined
          }
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            flow.setDepositAmount(event.target.value);
          }}
        />
        <SelectField
          label={t("account")}
          value={flow.accountId}
          disabled={noAccount}
          error={flow.depositProblem === "account_required"}
          options={wizard.bankAccounts.map((account) => ({
            value: account.id,
            label: account.name,
          }))}
          onChange={(next: string) => {
            flow.setAccountId(next);
          }}
        />
        <Fact
          label={t("after")}
          value={moneyText(flow.counted - flow.deposit)}
        />
        <Typography variant="caption" color="text.secondary">
          {t("hint")}
        </Typography>
      </Stack>
    </Card>
  );
};

/**
 * 日結第 ⑤ 步 確認(規格 6.10;Figma ST-25b):涵蓋計算期間、全店盤點方式、各班差額合計、小金庫差額、存入銀行;
 * [送出結帳確認申請](類型 = 日結,店長審核)。「日結單」列印由列印的功能加上。
 */
export const DailyCloseConfirmStep = ({
  wizard,
  flow,
}: DailyCloseCashStepProps) => {
  const t = useTranslations("admin.lotteryStore.dailyClose");
  const tCheckout = useTranslations("admin.lotteryStore.checkout");
  const shortTime = useShortTime();
  const stocktakeText = (() => {
    switch (flow.stocktakeMode) {
      case "reuse": {
        const reusable = wizard.reusableStocktake ?? null;
        return reusable === null
          ? ""
          : tCheckout("confirm.stocktakeReuse", {
              time: shortTime(reusable.startedAt) ?? "",
              scope: tCheckout("stocktake.wholeStore"),
              serial: reusable.serialNo ?? "",
            });
      }
      case "new": {
        return t("confirm.stocktakeNew", {
          count: flow.stocktake.review?.summary.backfillCount ?? 0,
        });
      }
      case "skip": {
        return t("confirm.stocktakeSkip");
      }
    }
  })();
  const account = wizard.bankAccounts.find(
    (option) => option.id === flow.accountId,
  );
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1">{t("confirm.title")}</Typography>
        <Fact
          label={t("confirm.period")}
          value={t("confirm.periodValue", {
            from: shortTime(wizard.coveredFrom) ?? t("confirm.firstClose"),
            to: shortTime(wizard.coveredTo) ?? t("confirm.now"),
          })}
        />
        <Fact label={t("confirm.stocktake")} value={stocktakeText} />
        <Fact
          label={t("confirm.shiftDifference")}
          value={signedMoneyText(wizard.differenceTotal)}
          tone={wizard.differenceTotal === 0 ? "text.primary" : "error.main"}
        />
        <Fact
          label={t("confirm.vaultDifference")}
          value={signedMoneyText(flow.difference)}
          tone={flow.difference === 0 ? "text.primary" : "error.main"}
        />
        <Fact
          label={t("confirm.bankDeposit")}
          value={
            flow.deposit > 0
              ? `${moneyText(flow.deposit)} → ${account?.name ?? ""}`
              : t("confirm.noDeposit")
          }
        />
      </Stack>
    </Card>
  );
};
