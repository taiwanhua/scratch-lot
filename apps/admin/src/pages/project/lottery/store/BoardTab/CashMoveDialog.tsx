import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import {
  type LotteryStoreShiftFieldsFragment,
  useDepositLotteryShiftCashMutation,
  useWithdrawLotteryShiftCashMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";
import {
  EMPTY_REASON,
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { storeErrorKey, storeErrorOf } from "@/lib/project/lottery/store-error";

import { moneyText } from "../store-text";
import { STORE_BOARD_QUERY_KEY } from "./board-query";

export interface CashMoveDialogProps {
  /** `deposit` 投庫(抽屜 → 小金庫)/ `withdraw` 出庫(小金庫 → 抽屜) */
  kind: "deposit" | "withdraw";
  shift: LotteryStoreShiftFieldsFragment;
  cashPointName: string;
  /** 小金庫目前的應有(出庫視窗顯示) */
  vaultExpected: number;
  onClose: () => void;
}

/**
 * 投庫 / 出庫(專案規格 6.7;Figma ST-12a 投庫、ST-12b 出庫):寫現金流水,不用審核、做完就生效。
 * 投庫顯示抽屜的應有(超過 → api 擋下);出庫原因必填(欄位管理「出庫原因」)。「自動列印」由列印的功能加上。
 */
export const CashMoveDialog = ({
  kind,
  shift,
  cashPointName,
  vaultExpected,
  onClose,
}: CashMoveDialogProps) => {
  const t = useTranslations("admin.lotteryStore");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const feedback = {
    error: (error: unknown) => t(storeErrorKey(error)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORE_BOARD_QUERY_KEY });
      onClose();
    },
    onError: (error: unknown) => {
      setErrorKey(storeErrorKey(error));
      setInvalid(storeErrorOf(error).fields ?? []);
    },
  };
  const deposit = useDepositLotteryShiftCashMutation(
    session.client,
    useMutationFeedback({ ...feedback, success: t("cash.depositSuccess") }),
  );
  const withdraw = useWithdrawLotteryShiftCashMutation(
    session.client,
    useMutationFeedback({ ...feedback, success: t("cash.withdrawSuccess") }),
  );
  const isPending = deposit.isPending || withdraw.isPending;
  const amountValue = Number(amount.trim());
  const isAmountValid =
    amount.trim() !== "" && Number.isInteger(amountValue) && amountValue > 0;

  const submit = () => {
    const missing: string[] = isAmountValid ? [] : ["amount"];
    if (kind === "withdraw") {
      missing.push(...missingReasonFields(reason));
    }
    setInvalid(missing);
    setErrorKey(null);
    if (missing.length > 0) {
      return;
    }
    const noteValue = note.trim() === "" ? null : note.trim();
    if (kind === "deposit") {
      deposit.mutate({
        input: { shiftId: shift.id, amount: amountValue, note: noteValue },
      });
      return;
    }
    withdraw.mutate({
      input: {
        shiftId: shift.id,
        amount: amountValue,
        ...reasonInputOf(reason),
        note: noteValue,
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
      title={
        kind === "deposit" ? t("cash.depositTitle") : t("cash.withdrawTitle")
      }
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cash.cancel")}
          </Button>
          <Button disabled={isPending} onClick={submit}>
            {kind === "deposit" ? t("cash.deposit") : t("cash.withdraw")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {errorKey === null ? null : (
          <Alert severity="error">{t(errorKey)}</Alert>
        )}
        <Stack
          direction="row"
          sx={{ justifyContent: "space-between", alignItems: "baseline" }}
        >
          <Typography variant="body2" color="text.secondary">
            {kind === "deposit"
              ? t("cash.drawerExpected", { name: cashPointName })
              : t("cash.vaultExpected")}
          </Typography>
          <Typography variant="h6" color="text.primary">
            {moneyText(kind === "deposit" ? shift.expectedCash : vaultExpected)}
          </Typography>
        </Stack>
        <TextField
          label={t("cash.amount")}
          value={amount}
          required
          error={invalid.includes("amount")}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
        {kind === "withdraw" ? (
          <ReasonFields
            categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.withdrawReason}
            label={t("cash.reason")}
            value={reason}
            invalid={invalid}
            onChange={setReason}
          />
        ) : null}
        <TextField
          label={t("cash.note")}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </Stack>
    </Dialog>
  );
};
