import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import { BANK_TRANSACTION_TYPES } from "@repo/domain/project/lottery-accounts";
import {
  type LotteryBankTransactionFieldsFragment,
  useLotteryBankAccountQuery,
  useLotteryBankTransactionsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import type { TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { DateFilterPicker } from "@/components/project/DateFilterPicker/DateFilterPicker";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";
import type { ModulePageProps } from "@/lib/base/module-tree";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

import { AccountsList } from "../AccountsList/AccountsList";
import { usageText } from "../BankAccountsTab/usage-text";
import { nextDayText } from "../CashLedgerTab/next-day";
import { TRANSACTIONS_TABLE_MIN_WIDTH, moneyText } from "../accounts-config";
import { useAccountsAccess } from "../useAccountsAccess";
import { AccountSettingsCard } from "./AccountSettingsCard";
import { AccountStatusActions } from "./AccountStatusActions";
import { RecordTransactionDialog } from "./RecordTransactionDialog";
import { ReverseTransactionDialog } from "./ReverseTransactionDialog";
import { UsageOrgsDialog } from "./UsageOrgsDialog";

type Transaction = LotteryBankTransactionFieldsFragment;

/** 交易清單的篩選放同一個 key(REACT-14):期間起迄(`YYYY-MM-DD`)、類型;空字串 = 預設(本月)/ 不篩。 */
const transactionsSchema = z
  .object({
    from: z.string().default(""),
    to: z.string().default(""),
    type: z.string().default(""),
  })
  .default({ from: "", to: "", type: "" });

/** 本月 1 日的 `YYYY-MM-DD`(期間篩選的預設起日)。 */
const monthStartOf = (today: string | null): string =>
  today === null ? "" : `${today.slice(0, 8)}01`;

const StatCard = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) => (
  <Card sx={{ p: 2, flex: 1, minWidth: 0 }}>
    <Typography variant="caption" color="textSecondary">
      {label}
    </Typography>
    <Typography
      variant="h6"
      color={tone === "warning" ? "warning" : "textPrimary"}
    >
      {value}
    </Typography>
  </Card>
);

/**
 * 銀行帳戶詳情(隱藏頁 `accounts.view-page`;Figma AC-02 93:400):
 * 頂部列([← 返回列表] ……… [設定使用組織] [停用帳戶] [刪除帳戶] [登記交易],REACT-16)→
 * 標題卡(戶名 · 銀行 分行 末 5 碼 + 狀態、使用組織)→ 餘額 / 期間收 / 期間支 →
 * 期間與類型篩選 → 交易清單(每列餘額依時間累加;[沖正] / 已沖正)→ 帳戶設定(要 `abilities.canEdit`,只有 [儲存])。
 */
export const BankAccountViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const access = useAccountsAccess();
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const id = routeParam ?? "";
  const today = localDayTextOf(new Date(), timezone);
  const [filters, setFilters] = useUrlState("transactions", transactionsSchema);
  const { from: fromParam, to: toParam, type } = filters;
  const patch = (next: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...next }));
  };
  const [dialog, setDialog] = useState<"record" | "usage" | null>(null);
  const [reversing, setReversing] = useState<Transaction | null>(null);
  const from = fromParam === "" ? monthStartOf(today) : fromParam;
  const to = toParam === "" ? (today ?? "") : toParam;

  const query = useLotteryBankAccountQuery(
    session.client,
    { id },
    { enabled: id !== "", retry: false },
  );
  const account = query.data?.lotteryBankAccount.item ?? null;
  const transactions = useLotteryBankTransactionsQuery(
    session.client,
    {
      input: {
        accountId: id,
        from: localDayInstantOf(from, timezone),
        to: localDayInstantOf(nextDayText(to), timezone),
        ...(type === "" ? {} : { type }),
      },
    },
    { enabled: account !== null },
  );
  useRouteTabItemLabel(account === null ? null : account.label, "view");

  if (query.isLoading) {
    return <CircularProgress aria-label={t("accountView.loading")} />;
  }
  if (account === null) {
    return (
      <Alert severity="error">
        {t(
          `errors.${query.error === null ? "NOT_FOUND" : accountsErrorOf(query.error).code}`,
        )}
      </Alert>
    );
  }

  const typeOptions: { value: string; label: string }[] = [
    { value: "", label: t("accountView.filters.all") },
    ...BANK_TRANSACTION_TYPES.map((value) => ({
      value,
      label: t(`transactionTypes.${value}`),
    })),
  ];
  const list = transactions.data?.lotteryBankTransactions;
  const rows = list?.items ?? [];
  const usage = usageText(account, t);
  const reversalOfText = (at: string) =>
    t("accountView.reversalOf", {
      date: formatTemporal(at, { type: "monthDay", timezone }),
    });
  const columns: TableColumn<Transaction>[] = [
    {
      key: "occurredAt",
      header: t("accountView.columns.occurredAt"),
      render: (row) =>
        formatTemporal(row.occurredAt, { type: "monthDayTime", timezone }),
    },
    {
      key: "type",
      header: t("accountView.columns.type"),
      render: (row) =>
        [
          t(`transactionTypes.${row.type}`),
          row.reversalOf ? t("accountView.reversal") : null,
          // 沖正沒有班:標原交易的日期
          row.reversalOfAt == null ? null : reversalOfText(row.reversalOfAt),
        ]
          .filter(Boolean)
          .join(" · "),
    },
    {
      key: "summary",
      header: t("accountView.columns.summary"),
      render: (row) => row.summary ?? row.note ?? "—",
    },
    {
      key: "branch",
      header: t("accountView.columns.branch"),
      render: (row) => row.branch?.name ?? "—",
    },
    {
      key: "in",
      header: t("accountView.columns.in"),
      align: "right",
      render: (row) => (row.direction === "in" ? moneyText(row.amount) : ""),
    },
    {
      key: "out",
      header: t("accountView.columns.out"),
      align: "right",
      render: (row) => (row.direction === "out" ? moneyText(row.amount) : ""),
    },
    {
      key: "balanceAfter",
      header: t("accountView.columns.balanceAfter"),
      align: "right",
      render: (row) => (
        <Typography
          variant="body2"
          color={row.balanceAfter < 0 ? "warning" : "textPrimary"}
        >
          {moneyText(row.balanceAfter)}
        </Typography>
      ),
    },
    {
      key: "actions",
      header: "",
      width: 96,
      render: (row) => {
        if (row.reversedById) {
          return (
            <Typography variant="caption" color="textSecondary">
              {t("accountView.reversed")}
            </Typography>
          );
        }
        return row.abilities.canReverse ? (
          <Button
            variant="text"
            size="small"
            color="error"
            onClick={() => {
              setReversing(row);
            }}
          >
            {t("accountView.reverse")}
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <Stack
      spacing={2}
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        "& > *": { flexShrink: 0 },
      }}
    >
      {/* 檢視頁的頂部列(REACT-16):左 [← 返回列表],右 次要 → 停用 / 刪除(error)→ 主要 [登記交易] */}
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
      >
        <Button
          variant="text"
          size="small"
          onClick={() => {
            if (access.listRoute !== null) {
              void navigate(tabHref(access.listRoute));
            }
          }}
        >
          {t("accountView.backToList")}
        </Button>
        <Box sx={{ flex: 1 }} />
        {account.abilities.canEdit && (
          <Button
            variant="outlined"
            onClick={() => {
              setDialog("usage");
            }}
          >
            {t("accountView.setUsage")}
          </Button>
        )}
        {account.abilities.canEdit && (
          <AccountStatusActions
            account={account}
            listRoute={access.listRoute}
            viewRoute={access.viewRoute}
          />
        )}
        {account.abilities.canRecordTransaction && (
          <Button
            onClick={() => {
              setDialog("record");
            }}
          >
            {t("accountView.record")}
          </Button>
        )}
      </Stack>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
        <Stack spacing={2}>
          <Stack spacing={1} sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Typography variant="h6">
                {[
                  account.accountName,
                  [account.bankCode, account.branchName]
                    .filter(Boolean)
                    .join(" "),
                  t("bankAccounts.accountNoTail", {
                    tail: account.accountNo.slice(-5),
                  }),
                ].join(" · ")}
              </Typography>
              <Tag
                tone={account.status === "active" ? "success" : "grey"}
                label={t(
                  `status.${account.status === "active" ? "active" : "inactive"}`,
                )}
              />
            </Stack>
            <Typography variant="body2" color="textSecondary">
              {usage === ""
                ? t("accountView.usageNone")
                : t("accountView.usage", { names: usage })}
            </Typography>
          </Stack>
        </Stack>
      </Card>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <StatCard
          label={t("accountView.balance")}
          value={moneyText(account.balance)}
          {...(account.balance < 0 ? { tone: "warning" as const } : {})}
        />
        <StatCard
          label={t("accountView.periodIn")}
          value={`+ ${moneyText(list?.totalIn ?? 0)}`}
        />
        <StatCard
          label={t("accountView.periodOut")}
          value={`− ${moneyText(list?.totalOut ?? 0)}`}
        />
      </Stack>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Box sx={{ maxWidth: { sm: 180 } }}>
              <DateFilterPicker
                label={t("accountView.filters.from")}
                value={from}
                size="small"
                onChange={(value) => {
                  patch({ from: value ?? "" });
                }}
              />
            </Box>
            <Box sx={{ maxWidth: { sm: 180 } }}>
              <DateFilterPicker
                label={t("accountView.filters.to")}
                value={to}
                size="small"
                onChange={(value) => {
                  patch({ to: value ?? "" });
                }}
              />
            </Box>
            <SelectField
              label={t("accountView.filters.type")}
              value={type}
              size="small"
              displayEmpty
              options={typeOptions}
              onChange={(value: string) => {
                patch({ type: value });
              }}
              sx={{ minWidth: 160 }}
            />
          </Stack>
          <AccountsList
            aria-label={t("accountView.listAria")}
            card={{ title: ["occurredAt", "type"], actions: "actions" }}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            isLoading={transactions.isLoading}
            emptyMessage={t("accountView.empty")}
            minWidth={TRANSACTIONS_TABLE_MIN_WIDTH}
          />
        </Stack>
      </Card>
      {account.abilities.canEdit && (
        <AccountSettingsCard key={account.updatedAt} account={account} />
      )}
      {dialog === "record" && (
        <RecordTransactionDialog
          account={account}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog === "usage" && (
        <UsageOrgsDialog
          account={account}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {reversing !== null && (
        <ReverseTransactionDialog
          transaction={reversing}
          onClose={() => {
            setReversing(null);
          }}
        />
      )}
    </Stack>
  );
};
