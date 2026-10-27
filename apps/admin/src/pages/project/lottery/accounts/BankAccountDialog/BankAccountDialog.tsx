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
  type FieldErrorTexts,
  withoutFieldError,
} from "@/lib/base/field-errors";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

import {
  accountErrorTextsOf,
  accountFormatErrorsOf,
} from "../account-field-errors";

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

const FIELDS: readonly Field[] = [
  "bankCode",
  "branchName",
  "accountNo",
  "accountName",
  "openingBalance",
  "openingDate",
  "shareOrgs",
];

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
  // 欄位錯了就在欄位正下方寫原因(REACT-18);上方提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<FieldErrorTexts<Field>>({});
  const [errorText, setErrorText] = useState<string | null>(null);

  const create = useCreateLotteryBankAccountMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.createSuccess"),
      error: (error: unknown) =>
        accountErrorTextsOf(accountsErrorOf(error), FIELDS, t).summary,
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: useLotteryBankAccountsQuery
            .getKey({ input: {} })
            .slice(0, 1),
        });
        onClose();
      },
      onError: (error: unknown) => {
        const { texts, summary } = accountErrorTextsOf(
          accountsErrorOf(error),
          FIELDS,
          t,
        );
        setFieldErrors(texts);
        setErrorText(summary);
      },
    }),
  );

  const change = (key: keyof typeof values, value: string | null) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => withoutFieldError(current, key));
  };
  const isInvalid = (field: Field) => fieldErrors[field] !== undefined;

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
    setFieldErrors(accountFormatErrorsOf(next, t));
    setErrorText(null);
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
        {errorText !== null && <Alert severity="error">{errorText}</Alert>}
        <Stack direction="row" spacing={2}>
          <TextField
            label={t("accountForm.fields.bankCode")}
            value={values.bankCode}
            required
            error={isInvalid("bankCode")}
            helperText={fieldErrors.bankCode ?? t("accountForm.bankCodeHint")}
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
            helperText={fieldErrors.branchName}
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
          helperText={fieldErrors.accountNo}
          onChange={(event) => {
            change("accountNo", event.target.value);
          }}
        />
        <TextField
          label={t("accountForm.fields.accountName")}
          value={values.accountName}
          required
          error={isInvalid("accountName")}
          helperText={fieldErrors.accountName}
          onChange={(event) => {
            change("accountName", event.target.value);
          }}
        />
        {/* 期初餘額、期初日期各自一行(使用者驗收要求:不並排) */}
        <TextField
          label={t("accountForm.fields.openingBalance")}
          value={values.openingBalance}
          required
          error={isInvalid("openingBalance")}
          helperText={fieldErrors.openingBalance}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            change("openingBalance", event.target.value);
          }}
        />
        <DatePicker
          label={t("accountForm.fields.openingDate")}
          value={values.openingDate}
          error={isInvalid("openingDate")}
          helperText={fieldErrors.openingDate}
          fullWidth
          onChange={(value) => {
            change("openingDate", value);
          }}
        />
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            {t("accountForm.usageTitle")}
          </Typography>
          <ShareOrgsField
            label={t("accountForm.fields.shareOrgs")}
            value={shareOrgs}
            error={isInvalid("shareOrgs")}
            helperText={fieldErrors.shareOrgs}
            onChange={(next) => {
              setShareOrgs(next);
              setFieldErrors((current) =>
                withoutFieldError(current, "shareOrgs"),
              );
            }}
          />
        </Stack>
        <Typography variant="caption" color="textSecondary">
          {t("accountForm.lockHint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
