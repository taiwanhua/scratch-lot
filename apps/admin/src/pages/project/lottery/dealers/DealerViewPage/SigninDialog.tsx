import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { useRegisterLotteryDealerSigninMutation } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
  formErrorSummary,
  withoutFieldError,
} from "@/lib/base/field-errors";
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";

import { dealerFieldErrorsOf, dealerFormatText } from "../dealer-field-errors";
import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import { useInvalidateDealers } from "../useInvalidateDealers";

/** 會標回對話框的欄位(api `fields`)。 */
const FIELDS = ["quarter", "signedAt", "note"] as const;

export interface SigninDialogProps {
  dealerId: string;
  year: number;
  /** 可以登記的季別(本季、已過沒登記的);未到的、已登記的不列 */
  openQuarters: readonly number[];
  onClose: () => void;
}

/** 登記見簽(Figma DE-06a):年度、季別、見簽日(不限定落在該季)、備註。 */
export const SigninDialog = ({
  dealerId,
  year,
  openQuarters,
  onClose,
}: SigninDialogProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const invalidate = useInvalidateDealers();
  const [quarter, setQuarter] = useState(String(openQuarters.at(-1) ?? ""));
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 欄位錯了就在欄位正下方寫原因(REACT-18);下方提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrorTexts<(typeof FIELDS)[number]>
  >({});
  const errorTextsOf = (failure: unknown) => {
    const parsed = dealersErrorOf(failure);
    const texts = dealerFieldErrorsOf(parsed, FIELDS, t);
    return {
      texts,
      summary: formErrorSummary(
        texts,
        tErrors(parsed.code),
        tErrors(dealersErrorKey(parsed)),
      ),
    };
  };
  const register = useRegisterLotteryDealerSigninMutation(session.client);
  const feedback = useMutationFeedback({
    success: t("feedback.signinSuccess"),
    error: (failure) => errorTextsOf(failure).summary,
  });

  const submit = async () => {
    const instant = localDayInstantOf(signedAt, timezone);
    const missing = [
      ...(quarter === "" ? (["quarter"] as const) : []),
      ...(instant === null ? (["signedAt"] as const) : []),
    ];
    if (missing.length > 0 || instant === null) {
      setFieldErrors(
        fieldErrorTextsOf(missing, FIELDS, (field) =>
          dealerFormatText(t, field),
        ),
      );
      setError(tErrors("VALIDATION_FAILED"));
      return;
    }
    try {
      await register.mutateAsync({
        input: {
          dealerId,
          year,
          quarter: Number(quarter),
          signedAt: instant,
          note: note.trim() === "" ? null : note.trim(),
        },
      });
      feedback.onSuccess();
      await invalidate();
      onClose();
    } catch (error_) {
      const { texts, summary } = errorTextsOf(error_);
      setFieldErrors(texts);
      setError(summary);
      feedback.onError(error_);
    }
  };

  return (
    <Dialog
      open
      title={t("signins.dialogTitle")}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button
            disabled={register.isPending}
            onClick={() => {
              void submit();
            }}
          >
            {t("actions.register")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1, minWidth: { sm: 360 } }}>
        <Stack direction="row" spacing={2}>
          <TextField
            label={t("signins.yearField")}
            value={String(year)}
            size="small"
            fullWidth
            slotProps={{ input: { readOnly: true } }}
          />
          <SelectField
            label={t("signins.quarterField")}
            value={quarter}
            size="small"
            fullWidth
            options={openQuarters.map((item) => ({
              value: String(item),
              label: t("signins.quarterOption", { quarter: String(item) }),
            }))}
            error={fieldErrors.quarter !== undefined}
            helperText={fieldErrors.quarter}
            onChange={(next) => {
              setQuarter(next);
              setFieldErrors((current) =>
                withoutFieldError(current, "quarter"),
              );
            }}
          />
        </Stack>
        <DatePicker
          label={t("signins.signedAt")}
          value={signedAt}
          required
          size="small"
          fullWidth
          error={fieldErrors.signedAt !== undefined}
          helperText={fieldErrors.signedAt}
          onChange={(next) => {
            setSignedAt(next);
            setFieldErrors((current) => withoutFieldError(current, "signedAt"));
          }}
        />
        <TextField
          label={t("signins.note")}
          value={note}
          size="small"
          fullWidth
          error={fieldErrors.note !== undefined}
          helperText={fieldErrors.note}
          onChange={(event) => {
            setNote(event.target.value);
            setFieldErrors((current) => withoutFieldError(current, "note"));
          }}
        />
        {error !== null && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Dialog>
  );
};
