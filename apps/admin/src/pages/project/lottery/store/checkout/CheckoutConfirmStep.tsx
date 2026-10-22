import { useTranslations } from "use-intl";

import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useLotteryFieldOptions } from "@/hooks/project/useLotteryFieldOptions/useLotteryFieldOptions";

import { moneyText } from "../store-text";
import { signedMoneyText } from "./checkout-text";
import type { CheckoutWizard, CheckoutWizardData } from "./useCheckoutWizard";

export interface CheckoutConfirmStepProps {
  wizard: CheckoutWizardData;
  flow: CheckoutWizard;
}

const NO_SUCCESSOR = "";

/**
 * 交班精靈第 ④ 步 確認(規格 6.9、8.7;Figma ST-19a / 19b):左欄應有現金各項、應有 / 實點 / 差額(含原因)與盤點方式;
 * 右欄交接:留給下一班、接班人(選填)。留給下一班 > 0 時接班人必填;沒有接班人 → 留給下一班必須是 0、改由店長審核。
 */
export const CheckoutConfirmStep = ({
  wizard,
  flow,
}: CheckoutConfirmStepProps) => {
  const t = useTranslations("admin.lotteryStore.checkout");
  const temporal = useTemporalText();
  const diffReasons = useLotteryFieldOptions(
    LOTTERY_FIELD_CATEGORY_KEYS.checkoutDiffReason,
  );
  const skipReasons = useLotteryFieldOptions(
    LOTTERY_FIELD_CATEGORY_KEYS.skipStocktakeReason,
  );
  const stocktakeText = (() => {
    switch (flow.stocktakeMode) {
      case "reuse": {
        const reusable = wizard.reusableStocktake ?? null;
        return reusable === null
          ? ""
          : t("confirm.stocktakeReuse", {
              time:
                temporal(reusable.startedAt, "monthDayTime")
                  .split(" ")
                  .at(-1) ?? "",
              scope: reusable.scopeName ?? t("stocktake.wholeStore"),
              serial: reusable.serialNo ?? "",
            });
      }
      case "new": {
        return t("confirm.stocktakeNew");
      }
      case "skip": {
        return t("confirm.stocktakeSkip", {
          reason: skipReasons.labelOf(flow.skipReason.reasonKey),
        });
      }
    }
  })();
  const differenceText =
    flow.difference === 0
      ? "0"
      : `${signedMoneyText(flow.difference)} · ${diffReasons.labelOf(flow.diffReason.reasonKey)}`;
  const rows: [string, string, boolean][] = [
    ...wizard.expectedItems
      .filter((item) => item.kind === "opening" || item.count > 0)
      .map((item): [string, string, boolean] => [
        t(`items.${item.kind}`),
        item.kind === "opening"
          ? moneyText(item.amount)
          : signedMoneyText(item.amount),
        false,
      ]),
    [t("confirm.expected"), moneyText(wizard.expected), true],
    [t("confirm.counted"), moneyText(flow.counted), true],
    [t("confirm.difference"), differenceText, true],
    [t("confirm.stocktake"), stocktakeText, false],
  ];
  const noSuccessor = flow.successorId === NO_SUCCESSOR;
  const mustBeZero = flow.handoverProblem === "must_be_zero";
  const exceedsCounted = flow.handoverProblem === "exceeds_counted";
  // 欄位錯了就在欄位正下方寫原因(REACT-18)
  let leftHelper: string | undefined;
  if (flow.handoverProblem === "invalid_amount") {
    leftHelper = t("confirm.invalidAmount");
  } else if (mustBeZero) {
    leftHelper = t("confirm.mustBeZero");
  } else if (exceedsCounted) {
    leftHelper = t("confirm.exceedsCounted", {
      counted: moneyText(flow.counted),
    });
  }
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        alignItems: "start",
      }}
    >
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={1}>
          <Typography variant="subtitle1">
            {t("confirm.summaryTitle")}
          </Typography>
          {rows.map(([label, value, strong]) => (
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
                  label === t("confirm.difference") && flow.difference !== 0
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
      </Card>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1">
            {t("confirm.handoverTitle")}
          </Typography>
          <TextField
            label={t("confirm.leftForNext")}
            value={flow.leftForNext}
            error={flow.handoverProblem !== null}
            helperText={leftHelper}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
            onChange={(event) => {
              flow.setLeftForNext(event.target.value);
            }}
          />
          <SelectField
            label={t("confirm.successor")}
            value={flow.successorId}
            displayEmpty
            options={[
              { value: NO_SUCCESSOR, label: t("confirm.noSuccessor") },
              ...wizard.successorOptions.map((option) => ({
                value: option.id,
                label: option.name,
              })),
            ]}
            onChange={(next: string) => {
              flow.setSuccessorId(next);
            }}
          />
          <Typography variant="caption" color="textSecondary">
            {t("confirm.hint")}
          </Typography>
          {noSuccessor ? (
            <Alert severity="info">{t("confirm.managerReview")}</Alert>
          ) : null}
        </Stack>
      </Card>
    </Box>
  );
};
