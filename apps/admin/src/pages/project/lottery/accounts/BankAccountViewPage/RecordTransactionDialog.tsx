import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  BANK_TRANSACTION_TYPES,
  type BankTransactionType,
  documentRequirementOf,
  fixedDirectionOf,
  requiresBranch,
  requiresSummary,
} from "@repo/domain/project/lottery-accounts";
import {
  type LotteryBankAccountFieldsFragment,
  useLotterySettlementCandidatesQuery,
  useRecordLotteryBankTransactionMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { DateTimePicker } from "@repo/ui/date-time-picker";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

import { moneyText } from "../accounts-config";
import { useInvalidateAccounts } from "../useInvalidateAccounts";

export interface RecordTransactionDialogProps {
  account: LotteryBankAccountFieldsFragment;
  onClose: () => void;
}

type Field =
  | "type"
  | "direction"
  | "refId"
  | "amount"
  | "occurredAt"
  | "branchOrgId"
  | "summary";

/**
 * 登記交易(Figma AC-03b 222:23044;規格 9、10.1):類型 → 單據(批貨收入 / 調貨收入必填、只列有待退或待收的)→
 * 金額 + 時間 → 歸屬分店(批貨與調貨必填)→ 摘要(調整、其他要選方向,說明必填)。
 */
export const RecordTransactionDialog = ({
  account,
  onClose,
}: RecordTransactionDialogProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const invalidate = useInvalidateAccounts();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [type, setType] = useState<BankTransactionType>("deposit");
  const [direction, setDirection] = useState<"in" | "out" | "">("");
  const [refId, setRefId] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState<string | null>(
    new Date().toISOString(),
  );
  const [branchOrgId, setBranchOrgId] = useState("");
  const [summary, setSummary] = useState("");
  const [invalid, setInvalid] = useState<Field[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const requirement = documentRequirementOf(type);
  const candidates = useLotterySettlementCandidatesQuery(
    session.client,
    { input: { type } },
    { enabled: requirement === "required" },
  );
  const documents = candidates.data?.lotterySettlementCandidates.items ?? [];
  const documentOptions = documents.map((row) => ({
    value: row.refId,
    label: t("recordForm.documentOption", {
      docNo: row.docNo,
      label: row.label,
      due: t(
        `outstanding.kinds.${row.kind === "to_receive" ? "to_receive" : "to_refund"}`,
        { amount: moneyText(row.amount) },
      ),
    }),
  }));

  const record = useRecordLotteryBankTransactionMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.recordSuccess"),
      error: (error: unknown) => t(`errors.${accountsErrorOf(error).code}`),
      onSuccess: () => {
        invalidate();
        onClose();
      },
      onError: (error: unknown) => {
        const parsed = accountsErrorOf(error);
        setErrorCode(parsed.code);
        setInvalid((parsed.fields ?? []) as Field[]);
      },
    }),
  );

  const amountValue = Number(amount.trim());
  const chooseType = (value: BankTransactionType) => {
    setType(value);
    setRefId("");
    setInvalid([]);
  };

  const selected = documents.find((row) => row.refId === refId);
  const needsDirection = fixedDirectionOf(type) === null;
  const invalidFields = (): Field[] => {
    const isAmountValid =
      amount.trim() !== "" && Number.isInteger(amountValue) && amountValue > 0;
    const checks: [Field, boolean][] = [
      ["direction", needsDirection && direction === ""],
      ["refId", requirement === "required" && refId === ""],
      ["amount", !isAmountValid],
      ["occurredAt", occurredAt === null],
      [
        "branchOrgId",
        requiresBranch(type) && branchOrgId === "" && selected === undefined,
      ],
      ["summary", requiresSummary(type) && summary.trim() === ""],
    ];
    return checks.filter(([, failed]) => failed).map(([field]) => field);
  };

  const submit = () => {
    const next = invalidFields();
    setInvalid(next);
    setErrorCode(null);
    if (next.length > 0 || occurredAt === null) {
      return;
    }
    record.mutate({
      input: {
        accountId: account.id,
        type,
        ...(needsDirection && direction !== "" ? { direction } : {}),
        amount: amountValue,
        occurredAt,
        ...(branchOrgId === "" ? {} : { branchOrgId }),
        ...(summary.trim() === "" ? {} : { summary: summary.trim() }),
        ...(selected === undefined
          ? {}
          : { refType: selected.moduleKey, refId: selected.refId }),
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
      title={t("recordForm.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("recordForm.cancel")}
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {t("recordForm.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        {errorCode !== null && (
          <Alert severity="error">{t(`errors.${errorCode}`)}</Alert>
        )}
        <SelectField
          label={t("recordForm.fields.type")}
          value={type}
          options={BANK_TRANSACTION_TYPES.map((value) => ({
            value,
            label: t(`transactionTypes.${value}`),
          }))}
          error={invalid.includes("type")}
          onChange={chooseType}
        />
        {fixedDirectionOf(type) === null && (
          <SelectField
            label={t("recordForm.fields.direction")}
            value={direction}
            options={[
              { value: "in" as const, label: t("direction.in") },
              { value: "out" as const, label: t("direction.out") },
            ]}
            required
            error={invalid.includes("direction")}
            onChange={setDirection}
          />
        )}
        {requirement === "required" && (
          <SelectField
            label={t("recordForm.fields.documentRequired")}
            value={refId}
            options={documentOptions}
            required
            error={invalid.includes("refId")}
            {...(documentOptions.length === 0 && !candidates.isLoading
              ? { helperText: t("recordForm.noDocument") }
              : {})}
            onChange={(value) => {
              setRefId(value);
              const row = documents.find((item) => item.refId === value);
              if (row !== undefined) {
                setAmount(String(row.amount));
                setBranchOrgId(row.branch.id);
              }
            }}
          />
        )}
        <Stack direction="row" spacing={2}>
          <TextField
            label={t("recordForm.fields.amount")}
            value={amount}
            required
            error={invalid.includes("amount")}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            sx={{ flex: 1 }}
          />
          <DateTimePicker
            label={t("recordForm.fields.occurredAt")}
            value={occurredAt}
            timezone={timezone}
            error={invalid.includes("occurredAt")}
            onChange={setOccurredAt}
            sx={{ flex: 1 }}
          />
        </Stack>
        <OrgTreeSelect
          scope="visible"
          label={t("recordForm.fields.branchOrgId")}
          value={branchOrgId === "" ? [] : [branchOrgId]}
          required={requiresBranch(type)}
          fullWidth
          error={invalid.includes("branchOrgId")}
          onChange={(ids) => {
            setBranchOrgId(ids.at(0) ?? "");
          }}
        />
        <TextField
          label={t("recordForm.fields.summary")}
          value={summary}
          required={requiresSummary(type)}
          error={invalid.includes("summary")}
          onChange={(event) => {
            setSummary(event.target.value);
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {t("recordForm.hint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
