import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  useDepositLotteryVaultToBankMutation,
  useLotteryBankDepositFormQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { storeErrorKey, storeErrorOf } from "@/lib/project/lottery/store-error";

import { STORE_BOARD_QUERY_KEY } from "../BoardTab/board-query";
import { moneyText } from "../store-text";
import { STORE_BANK_DEPOSIT_FORM_QUERY_KEY } from "./daily-close-keys";

/** 存銀行寫入成功後交給列印的資料(58mm 存款單)。 */
export interface BankDepositCommitted {
  movementId: string;
  branchId: string;
  branchName: string;
  amount: number;
  accountName: string;
  note: string | null;
}

export interface BankDepositDialogProps {
  orgId: string;
  onClose: () => void;
  /** 寫入成功之後(列印存款單;寫入失敗不會呼叫) */
  onCommitted?: (committed: BankDepositCommitted) => void;
}

/**
 * 存銀行(專案規格 6.11;Figma ST-26a、ST-26b):小金庫 → 銀行,不用審核、做完就生效。金額、存入帳戶
 * (使用中、使用組織包含這家分店;只有一個時自動帶入)、備註。金額超過小金庫應有(扣掉審核中日結要存入銀行的金額)→ 擋下
 * (提示先用現金更正單補登);
 * 本店沒有可用的銀行帳戶 → 錯誤提示、不能存。寫入成功 → `onCommitted`(看板據此自動印存款單,規格第 12 章)。
 */
export const BankDepositDialog = ({
  orgId,
  onClose,
  onCommitted,
}: BankDepositDialogProps) => {
  const t = useTranslations("admin.lotteryStore");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const form = useLotteryBankDepositFormQuery(
    session.client,
    { orgId },
    { retry: false },
  );
  const data = form.data?.lotteryBankDepositForm ?? null;
  const accounts = data?.accounts ?? [];
  const [amount, setAmount] = useState("");
  const [chosen, setChosen] = useState("");
  const [note, setNote] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // 只有一個帳戶時自動帶入
  const accountId =
    chosen === "" && accounts.length === 1 ? (accounts[0]?.id ?? "") : chosen;
  const deposit = useDepositLotteryVaultToBankMutation(
    session.client,
    useMutationFeedback({
      success: t("bankDeposit.success"),
      error: (error: unknown) => t(storeErrorKey(error)),
      onSuccess: (result, variables) => {
        const { input } = variables;
        onCommitted?.({
          movementId: result.depositLotteryVaultToBank.movementId,
          branchId: orgId,
          branchName: data?.org.name ?? "",
          amount: input.amount,
          accountName:
            accounts.find((account) => account.id === input.accountId)?.name ??
            "",
          note: input.note ?? null,
        });
        void queryClient.invalidateQueries({
          queryKey: STORE_BOARD_QUERY_KEY,
        });
        void queryClient.invalidateQueries({
          queryKey: STORE_BANK_DEPOSIT_FORM_QUERY_KEY,
        });
        onClose();
      },
      onError: (error: unknown) => {
        setErrorKey(storeErrorKey(error));
        setInvalid(storeErrorOf(error).fields ?? []);
      },
    }),
  );
  const amountValue = Number(amount.trim());
  const isAmountValid =
    amount.trim() !== "" && Number.isInteger(amountValue) && amountValue > 0;
  // 能存的上限 = 小金庫應有 − 審核中日結要存入銀行的金額
  const available = data === null ? 0 : data.vaultExpected - data.reserved;
  const exceeds = isAmountValid && data !== null && amountValue > available;
  const noAccount = data !== null && accounts.length === 0;

  const submit = () => {
    const missing: string[] = [];
    if (!isAmountValid || exceeds) {
      missing.push("amount");
    }
    if (accountId === "") {
      missing.push("accountId");
    }
    setInvalid(missing);
    setErrorKey(null);
    if (missing.length > 0) {
      return;
    }
    deposit.mutate({
      input: {
        orgId,
        amount: amountValue,
        accountId,
        note: note.trim() === "" ? null : note.trim(),
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
      title={t("bankDeposit.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("bankDeposit.cancel")}
          </Button>
          <Button
            disabled={deposit.isPending || noAccount || exceeds}
            onClick={submit}
          >
            {t("bankDeposit.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {data === null ? null : (
          <Typography variant="body2" color="textSecondary">
            {t("bankDeposit.vault", {
              store: data.org.name,
              amount: moneyText(data.vaultExpected),
            })}
          </Typography>
        )}
        {data !== null && data.reserved > 0 ? (
          <Typography variant="body2" color="textSecondary">
            {t("bankDeposit.reserved", {
              amount: moneyText(data.reserved),
              available: moneyText(available),
            })}
          </Typography>
        ) : null}
        {noAccount ? (
          <Alert severity="error">{t("errors.BANK_DEPOSIT_NO_ACCOUNT")}</Alert>
        ) : null}
        {errorKey === null ? null : (
          <Alert severity="error">{t(errorKey)}</Alert>
        )}
        <TextField
          label={t("bankDeposit.amount")}
          value={amount}
          required
          error={invalid.includes("amount") || exceeds}
          helperText={
            exceeds
              ? t("bankDeposit.exceeds", {
                  amount: moneyText(available),
                })
              : undefined
          }
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
        <SelectField
          label={t("bankDeposit.account")}
          value={accountId}
          required
          disabled={noAccount}
          error={invalid.includes("accountId")}
          options={accounts.map((account) => ({
            value: account.id,
            label: account.name,
          }))}
          onChange={(next: string) => {
            setChosen(next);
          }}
        />
        <TextField
          label={t("bankDeposit.note")}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <Typography variant="caption" color="textSecondary">
          {t("bankDeposit.hint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
