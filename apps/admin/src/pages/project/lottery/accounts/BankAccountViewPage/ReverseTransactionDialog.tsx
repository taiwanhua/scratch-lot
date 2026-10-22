import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import {
  type LotteryBankTransactionFieldsFragment,
  useReverseLotteryBankTransactionMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

import { moneyText } from "../accounts-config";
import { useInvalidateAccounts } from "../useInvalidateAccounts";

export interface ReverseTransactionDialogProps {
  transaction: LotteryBankTransactionFieldsFragment;
  onClose: () => void;
}

/**
 * 沖正(Figma AC-03c 222:23098):原交易、原因(必填);會寫一筆相反方向、同金額的交易,原交易保留。
 */
export const ReverseTransactionDialog = ({
  transaction,
  onClose,
}: ReverseTransactionDialogProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const invalidate = useInvalidateAccounts();
  const [reason, setReason] = useState("");
  const [isInvalid, setInvalid] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const reverse = useReverseLotteryBankTransactionMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.reverseSuccess"),
      error: (error: unknown) => t(`errors.${accountsErrorOf(error).code}`),
      onSuccess: () => {
        invalidate();
        onClose();
      },
      onError: (error: unknown) => {
        setErrorCode(accountsErrorOf(error).code);
      },
    }),
  );
  const submit = () => {
    if (reason.trim() === "") {
      setInvalid(true);
      return;
    }
    reverse.mutate({ input: { id: transaction.id, reason: reason.trim() } });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      fullScreen={isMobile}
      title={t("reverseForm.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("reverseForm.cancel")}
          </Button>
          <Button color="error" onClick={submit} disabled={reverse.isPending}>
            {t("reverseForm.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {errorCode !== null && (
          <Alert severity="error">{t(`errors.${errorCode}`)}</Alert>
        )}
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="body2" color="textSecondary">
            {t("reverseForm.original")}
          </Typography>
          <Typography variant="body2">
            {t("reverseForm.originalValue", {
              date: formatTemporal(transaction.occurredAt, {
                type: "monthDay",
                timezone,
              }),
              type: t(`transactionTypes.${transaction.type}`),
              amount: moneyText(transaction.amount),
            })}
          </Typography>
        </Stack>
        <TextField
          label={t("reverseForm.reason")}
          value={reason}
          required
          error={isInvalid}
          onChange={(event) => {
            setReason(event.target.value);
            setInvalid(false);
          }}
        />
        <Typography variant="caption" color="textSecondary">
          {t("reverseForm.hint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
