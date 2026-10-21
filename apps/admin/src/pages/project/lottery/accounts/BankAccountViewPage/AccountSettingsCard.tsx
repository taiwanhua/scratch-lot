import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  type LotteryBankAccountFieldsFragment,
  useUpdateLotteryBankAccountMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { DatePicker } from "@repo/ui/date-picker";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

import { useInvalidateAccounts } from "../useInvalidateAccounts";

export interface AccountSettingsCardProps {
  account: LotteryBankAccountFieldsFragment;
}

type Field =
  | "bankCode"
  | "accountNo"
  | "accountName"
  | "branchName"
  | "openingBalance"
  | "openingDate";

const GRID_SX = {
  display: "grid",
  gap: 2,
  gridTemplateColumns: {
    xs: "1fr",
    sm: "repeat(2, 1fr)",
    md: "repeat(3, 1fr)",
  },
} as const;

/**
 * 帳戶設定(Figma AC-02 下方;要 `abilities.canEdit`):銀行代碼、帳號、戶名、分行隨時可改;
 * 有交易之後期初餘額、期初日期鎖定(唯讀)。卡片只有 [儲存];[停用帳戶] / [刪除帳戶] 在頁面頂部列
 * (`AccountStatusActions`,REACT-16)。
 */
export const AccountSettingsCard = ({ account }: AccountSettingsCardProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const invalidate = useInvalidateAccounts();
  const [values, setValues] = useState(() => ({
    bankCode: account.bankCode,
    accountNo: account.accountNo,
    accountName: account.accountName,
    branchName: account.branchName ?? "",
    openingBalance: String(account.openingBalance),
    openingDate: localDayTextOf(account.openingDate, timezone),
  }));
  const [invalid, setInvalid] = useState<Field[]>([]);
  const locked = account.hasTransactions;

  const onError = (error: unknown) => {
    setInvalid((accountsErrorOf(error).fields ?? []) as Field[]);
  };
  const feedbackError = (error: unknown) =>
    t(`errors.${accountsErrorOf(error).code}`);
  const update = useUpdateLotteryBankAccountMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.saveSuccess"),
      error: feedbackError,
      onSuccess: invalidate,
      onError,
    }),
  );
  const change = (key: keyof typeof values, value: string | null) => {
    setValues((current) => ({ ...current, [key]: value }));
    setInvalid((current) => current.filter((field) => field !== key));
  };
  const save = () => {
    const opening = Number(values.openingBalance.trim());
    const openingDate = localDayInstantOf(values.openingDate, timezone);
    update.mutate({
      input: {
        id: account.id,
        bankCode: values.bankCode.trim(),
        accountNo: values.accountNo.trim(),
        accountName: values.accountName.trim(),
        branchName:
          values.branchName.trim() === "" ? null : values.branchName.trim(),
        ...(locked || !Number.isInteger(opening)
          ? {}
          : { openingBalance: opening }),
        ...(locked || openingDate === null ? {} : { openingDate }),
      },
    });
  };
  const text = (field: Field, isDisabled = false) => (
    <TextField
      label={t(`accountForm.fields.${field}`)}
      value={values[field] ?? ""}
      disabled={isDisabled}
      error={invalid.includes(field)}
      onChange={(event) => {
        change(field, event.target.value);
      }}
    />
  );

  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">{t("accountView.settings")}</Typography>
        <Box sx={GRID_SX}>
          {text("bankCode")}
          {text("accountNo")}
          {text("accountName")}
          {text("branchName")}
          {text("openingBalance", locked)}
          <DatePicker
            label={t("accountForm.fields.openingDate")}
            value={values.openingDate}
            disabled={locked}
            error={invalid.includes("openingDate")}
            fullWidth
            onChange={(value) => {
              change("openingDate", value);
            }}
          />
        </Box>
        {locked && (
          <Typography variant="caption" color="text.secondary">
            {t("accountForm.lockHint")}
          </Typography>
        )}
        <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
          <Button onClick={save} disabled={update.isPending}>
            {t("accountView.save")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};
