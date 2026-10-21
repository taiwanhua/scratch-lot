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
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";

import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import { useInvalidateDealers } from "../useInvalidateDealers";

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
  const register = useRegisterLotteryDealerSigninMutation(session.client);
  const feedback = useMutationFeedback({
    success: t("feedback.signinSuccess"),
    error: (failure) => tErrors(dealersErrorKey(dealersErrorOf(failure))),
  });

  const submit = async () => {
    const instant = localDayInstantOf(signedAt, timezone);
    if (quarter === "" || instant === null) {
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
      setError(tErrors(dealersErrorKey(dealersErrorOf(error_))));
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
            onChange={setQuarter}
          />
        </Stack>
        <DatePicker
          label={t("signins.signedAt")}
          value={signedAt}
          required
          size="small"
          fullWidth
          onChange={setSignedAt}
        />
        <TextField
          label={t("signins.note")}
          value={note}
          size="small"
          fullWidth
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        {error !== null && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Dialog>
  );
};
