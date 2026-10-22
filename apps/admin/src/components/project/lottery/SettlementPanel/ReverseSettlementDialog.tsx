import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import {
  type LotterySettlementFieldsFragment,
  useReverseLotterySettlementMutation,
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

import { moneyText, settlementErrorKey } from "./settlement-text";

export interface ReverseSettlementDialogProps {
  record: LotterySettlementFieldsFragment["records"][number];
  typeLabel: string;
  onClose: () => void;
  onDone?: () => void;
}

/** 沖正收付的一筆(同 Figma AC-03c 的版面):原交易、原因(必填);寫一筆相反方向的,原交易保留。 */
export const ReverseSettlementDialog = ({
  record,
  typeLabel,
  onClose,
  onDone,
}: ReverseSettlementDialogProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [reason, setReason] = useState("");
  const [isInvalid, setInvalid] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const reverse = useReverseLotterySettlementMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.reverseSuccess"),
      error: (error: unknown) => t(settlementErrorKey(error)),
      onSuccess: () => {
        onDone?.();
        onClose();
      },
      onError: (error: unknown) => {
        setErrorKey(settlementErrorKey(error));
      },
    }),
  );
  const submit = () => {
    if (reason.trim() === "") {
      setInvalid(true);
      return;
    }
    reverse.mutate({
      input: { method: record.method, id: record.id, reason: reason.trim() },
    });
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
        {errorKey !== null && <Alert severity="error">{t(errorKey)}</Alert>}
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="body2" color="textSecondary">
            {t("reverseForm.original")}
          </Typography>
          <Typography variant="body2">
            {t("reverseForm.originalValue", {
              date: formatTemporal(record.occurredAt, {
                type: "monthDay",
                timezone,
              }),
              type: typeLabel,
              amount: moneyText(record.amount),
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
