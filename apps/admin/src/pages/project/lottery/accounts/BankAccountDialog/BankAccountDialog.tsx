import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  useCreateLotteryBankAccountMutation,
  useLotteryBankAccountsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import {
  type ShareOrgValue,
  ShareOrgsField,
} from "@/components/base/ShareOrgsField/ShareOrgsField";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";
import {
  type AccountsErrorCode,
  accountsErrorOf,
} from "@/lib/project/lottery/accounts-error";

export interface BankAccountDialogProps {
  onClose: () => void;
}

type Field =
  | "bankCode"
  | "branchName"
  | "accountNo"
  | "accountName"
  | "openingBalance"
  | "openingDate"
  | "shareOrgs";

const BANK_CODE = /^\d{3}$/;

/**
 * 新增帳戶(Figma AC-03a 222:22990;手機全螢幕):銀行代碼 + 分行、帳號、戶名、期初餘額 + 期初日期、
 * 使用組織(可以多個;選最上層組織並勾含下層 = 全部分店)。
 */
export const BankAccountDialog = ({ onClose }: BankAccountDialogProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [values, setValues] = useState({
    bankCode: "",
    branchName: "",
    accountNo: "",
    accountName: "",
    openingBalance: "0",
    openingDate: localDayTextOf(new Date(), timezone),
  });
  const [shareOrgs, setShareOrgs] = useState<ShareOrgValue[]>([]);
  const [invalid, setInvalid] = useState<Field[]>([]);
  const [errorCode, setErrorCode] = useState<AccountsErrorCode | null>(null);

  const create = useCreateLotteryBankAccountMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.createSuccess"),
      error: (error: unknown) => t(`errors.${accountsErrorOf(error).code}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: useLotteryBankAccountsQuery
            .getKey({ input: {} })
            .slice(0, 1),
        });
        onClose();
      },
      onError: (error: unknown) => {
        const parsed = accountsErrorOf(error);
        setErrorCode(parsed.code);
        setInvalid((parsed.fields ?? []) as Field[]);
      },
    }),
  );

  const change = (key: keyof typeof values, value: string | null) => {
    setValues((current) => ({ ...current, [key]: value }));
    setInvalid((current) => current.filter((field) => field !== key));
  };
  const isInvalid = (field: Field) => invalid.includes(field);

  const submit = () => {
    const opening = Number(values.openingBalance.trim());
    const openingDate = localDayInstantOf(values.openingDate, timezone);
    const next: Field[] = [];
    if (!BANK_CODE.test(values.bankCode.trim())) next.push("bankCode");
    if (values.accountNo.trim() === "") next.push("accountNo");
    if (values.accountName.trim() === "") next.push("accountName");
    if (values.openingBalance.trim() === "" || !Number.isInteger(opening)) {
      next.push("openingBalance");
    }
    if (openingDate === null) next.push("openingDate");
    setInvalid(next);
    setErrorCode(null);
    if (next.length > 0 || openingDate === null) {
      return;
    }
    create.mutate({
      input: {
        bankCode: values.bankCode.trim(),
        branchName:
          values.branchName.trim() === "" ? null : values.branchName.trim(),
        accountNo: values.accountNo.trim(),
        accountName: values.accountName.trim(),
        openingBalance: opening,
        openingDate,
        shareOrgs,
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      fullScreen={isMobile}
      title={t("accountForm.createTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("accountForm.cancel")}
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {t("accountForm.create")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        {errorCode !== null && (
          <Alert severity="error">{t(`errors.${errorCode}`)}</Alert>
        )}
        <Stack direction="row" spacing={2}>
          <TextField
            label={t("accountForm.fields.bankCode")}
            value={values.bankCode}
            required
            error={isInvalid("bankCode")}
            helperText={t("accountForm.bankCodeHint")}
            slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 3 } }}
            onChange={(event) => {
              change("bankCode", event.target.value);
            }}
            sx={{ flex: 1 }}
          />
          <TextField
            label={t("accountForm.fields.branchName")}
            value={values.branchName}
            error={isInvalid("branchName")}
            onChange={(event) => {
              change("branchName", event.target.value);
            }}
            sx={{ flex: 1 }}
          />
        </Stack>
        <TextField
          label={t("accountForm.fields.accountNo")}
          value={values.accountNo}
          required
          error={isInvalid("accountNo")}
          onChange={(event) => {
            change("accountNo", event.target.value);
          }}
        />
        <TextField
          label={t("accountForm.fields.accountName")}
          value={values.accountName}
          required
          error={isInvalid("accountName")}
          onChange={(event) => {
            change("accountName", event.target.value);
          }}
        />
        <Stack direction="row" spacing={2}>
          <TextField
            label={t("accountForm.fields.openingBalance")}
            value={values.openingBalance}
            required
            error={isInvalid("openingBalance")}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
            onChange={(event) => {
              change("openingBalance", event.target.value);
            }}
            sx={{ flex: 1 }}
          />
          <DatePicker
            label={t("accountForm.fields.openingDate")}
            value={values.openingDate}
            error={isInvalid("openingDate")}
            fullWidth
            onChange={(value) => {
              change("openingDate", value);
            }}
          />
        </Stack>
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            {t("accountForm.usageTitle")}
          </Typography>
          <ShareOrgsField
            label={t("accountForm.fields.shareOrgs")}
            value={shareOrgs}
            error={isInvalid("shareOrgs")}
            onChange={setShareOrgs}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t("accountForm.lockHint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
