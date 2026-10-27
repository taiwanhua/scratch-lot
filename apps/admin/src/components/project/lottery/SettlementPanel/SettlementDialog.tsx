import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotterySettlementFieldsFragment,
  useLotterySettlementAccountsQuery,
  useRecordLotterySettlementMutation,
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
import {
  type FieldErrorTexts,
  withoutFieldError,
} from "@/lib/base/field-errors";

import {
  buttonLabelKey,
  moneyText,
  settlementErrorTextsOf,
  settlementFormatErrorsOf,
} from "./settlement-text";

export interface SettlementDialogProps {
  settlement: LotterySettlementFieldsFragment;
  /** 哪一邊(`side`) */
  side: string;
  /** 哪一顆:`out` 支出 / `in` 收入 */
  button: "out" | "in";
  onClose: () => void;
  /** 寫入成功(呼叫端重抓自己的資料) */
  onDone?: () => void;
  /** 寫入成功:這一筆收付的 id 與寫入後的收付現況(呼叫端在交易後列印付款收據) */
  onRecorded?: (
    recordId: string,
    item: LotterySettlementFieldsFragment,
  ) => void;
}

type Field = "method" | "accountId" | "cashSource" | "amount" | "handler";

const FIELDS: readonly Field[] = [
  "method",
  "accountId",
  "cashSource",
  "amount",
  "handler",
];

/** 現金來源「小金庫」的選項值(其他選項是收銀點 id)。 */
const VAULT = "vault";

/** 現金來源 → api 的輸入:小金庫,或有開著班的收銀點抽屜(收銀點 id)。 */
const cashSourceInput = (value: string) =>
  value === VAULT
    ? { cashSource: VAULT }
    : { cashSource: "drawer", cashPointId: value };

/**
 * 付款 / 收款視窗(規格 9,[付款] [收到退款] [收款] [退款] 共用):單據資訊(唯讀)、付款方式、
 * 帳戶 / 來源、金額(先填這一邊按下去剛好結清的金額,可以改)、經手人 / 收款人(現金必填)、備註。
 * 帳戶只列使用中、使用組織包含這一邊分店的;金額 = 0 時 [確認] 停用。
 */
export const SettlementDialog = ({
  settlement,
  side,
  button,
  onClose,
  onDone,
  onRecorded,
}: SettlementDialogProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const sideInfo = settlement.sides.find((item) => item.side === side);
  const defaultAmount =
    sideInfo?.buttons.find((item) => item.button === button)?.defaultAmount ??
    0;
  const methods = sideInfo?.methods ?? ["bank"];
  const [method, setMethod] = useState(methods[0] ?? "bank");
  const [accountId, setAccountId] = useState("");
  /** 現金來源:`vault` 小金庫,或開著班的收銀點抽屜(值 = 收銀點 id)。 */
  const [cashSource, setCashSource] = useState(VAULT);
  const [amount, setAmount] = useState(String(defaultAmount));
  const [handler, setHandler] = useState("");
  const [note, setNote] = useState("");
  // 欄位錯了就在欄位正下方寫原因(REACT-18);上方提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<FieldErrorTexts<Field>>({});
  const invalid = Object.keys(fieldErrors);
  const [errorText, setErrorText] = useState<string | null>(null);
  const clearError = (field: Field) => {
    setFieldErrors((current) => withoutFieldError(current, field));
  };

  const accounts = useLotterySettlementAccountsQuery(
    session.client,
    { moduleKey: settlement.moduleKey, refId: settlement.refId, side },
    { enabled: method === "bank" },
  );
  const accountOptions = (
    accounts.data?.lotterySettlementAccounts.items ?? []
  ).map((item) => ({ value: item.id, label: item.name }));

  const record = useRecordLotterySettlementMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.recordSuccess"),
      error: (error: unknown) =>
        settlementErrorTextsOf(error, FIELDS, t).summary,
      onSuccess: (payload) => {
        const { recordId, item } = payload.recordLotterySettlement;
        onRecorded?.(recordId, item);
        onDone?.();
        onClose();
      },
      onError: (error: unknown) => {
        const { texts, summary } = settlementErrorTextsOf(error, FIELDS, t);
        setFieldErrors(texts);
        setErrorText(summary);
      },
    }),
  );

  const noAccountHint =
    accountOptions.length === 0 && !accounts.isLoading
      ? t("settleForm.noAccount")
      : undefined;
  const amountValue = Number(amount.trim());
  const isAmountValid =
    amount.trim() !== "" && Number.isInteger(amountValue) && amountValue > 0;
  const role = sideInfo?.role === "payee" ? "payee" : "payer";

  const submit = () => {
    const next: Field[] = [];
    if (!isAmountValid) next.push("amount");
    if (method === "bank" && accountId === "") next.push("accountId");
    if (method === "cash" && handler.trim() === "") next.push("handler");
    setFieldErrors(settlementFormatErrorsOf(next, t));
    setErrorText(null);
    if (next.length > 0) {
      return;
    }
    record.mutate({
      input: {
        moduleKey: settlement.moduleKey,
        refId: settlement.refId,
        side,
        button,
        method,
        amount: amountValue,
        ...(method === "bank" ? { accountId } : cashSourceInput(cashSource)),
        handler: handler.trim() === "" ? null : handler.trim(),
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
      title={t(buttonLabelKey(role, button))}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("settleForm.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={record.isPending || !isAmountValid}
          >
            {t("settleForm.confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        {errorText !== null && <Alert severity="error">{errorText}</Alert>}
        <Stack spacing={0.5}>
          <Typography variant="body2" color="textSecondary">
            {t("settleForm.documentValue", {
              docNo: settlement.docNo,
              label: settlement.label,
            })}
          </Typography>
          <Typography variant="body2">
            {t(
              settlement.kind === "transfer"
                ? "settleForm.transferAmount"
                : "settleForm.payable",
            )}{" "}
            {moneyText(settlement.payable)} · {t("settleForm.net")}{" "}
            {moneyText(sideInfo?.net ?? 0)}
          </Typography>
        </Stack>
        {methods.length > 1 && (
          <SelectField
            label={t("settleForm.fields.method")}
            value={method}
            options={methods.map((value) => ({
              value,
              label: t(
                `settlement.methods.${value === "cash" ? "cash" : "bank"}`,
              ),
            }))}
            onChange={setMethod}
          />
        )}
        {method === "bank" ? (
          <SelectField
            label={t("settleForm.fields.accountId")}
            value={accountId}
            options={accountOptions}
            required
            error={invalid.includes("accountId")}
            helperText={fieldErrors.accountId ?? noAccountHint}
            onChange={(next) => {
              setAccountId(next);
              clearError("accountId");
            }}
          />
        ) : (
          <SelectField
            label={t("settleForm.fields.cashSource")}
            value={cashSource}
            options={[
              { value: VAULT, label: t("settleForm.sources.vault") },
              ...(sideInfo?.cashDrawers ?? []).map((drawer) => ({
                value: drawer.id,
                label: t("settleForm.sources.drawerOf", { name: drawer.name }),
              })),
            ]}
            error={invalid.includes("cashSource")}
            helperText={fieldErrors.cashSource}
            onChange={(next) => {
              setCashSource(next);
              clearError("cashSource");
            }}
          />
        )}
        <TextField
          label={t("settleForm.fields.amount")}
          value={amount}
          required
          error={invalid.includes("amount")}
          helperText={fieldErrors.amount}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            setAmount(event.target.value);
            clearError("amount");
          }}
        />
        <TextField
          label={t(
            method === "cash"
              ? "settleForm.fields.handlerRequired"
              : "settleForm.fields.handler",
          )}
          value={handler}
          required={method === "cash"}
          error={invalid.includes("handler")}
          helperText={fieldErrors.handler}
          onChange={(event) => {
            setHandler(event.target.value);
            clearError("handler");
          }}
        />
        <TextField
          label={t("settleForm.fields.note")}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </Stack>
    </Dialog>
  );
};
