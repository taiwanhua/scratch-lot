import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type LotteryBankAccountFieldsFragment,
  useLotteryBankAccountsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";

import { BankAccountDialog } from "../BankAccountDialog/BankAccountDialog";
import { BANK_ACCOUNTS_TABLE_MIN_WIDTH, moneyText } from "../accounts-config";
import { useAccountsAccess } from "../useAccountsAccess";
import { usageText } from "./usage-text";

export interface BankAccountsTabProps {
  /** 右上 [+ 新增帳戶] 按下後由頁面打開 */
  isCreating: boolean;
  onCloseCreate: () => void;
}

/**
 * 銀行帳戶分頁(Figma AC-01 93:17):戶名、銀行 / 分行、帳號末 5 碼、使用組織、餘額(負數警告色)、狀態;
 * 點列進帳戶詳情(綁了詳情頁才點得進去)。看得到的帳戶 = 總部看全部、分店看使用組織包含自己的。
 */
export const BankAccountsTab = ({
  isCreating,
  onCloseCreate,
}: BankAccountsTabProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const navigate = useNavigate();
  const access = useAccountsAccess();
  const query = useLotteryBankAccountsQuery(session.client, { input: {} });
  const rows = query.data?.lotteryBankAccounts.items ?? [];

  const columns: TableColumn<LotteryBankAccountFieldsFragment>[] = [
    {
      key: "accountName",
      header: t("bankAccounts.columns.accountName"),
      isEmphasized: true,
      render: (row) => row.accountName,
    },
    {
      key: "bank",
      header: t("bankAccounts.columns.bank"),
      render: (row) =>
        row.branchName ? `${row.bankCode} · ${row.branchName}` : row.bankCode,
    },
    {
      key: "accountNo",
      header: t("bankAccounts.columns.accountNo"),
      render: (row) =>
        t("bankAccounts.accountNoTail", { tail: row.accountNo.slice(-5) }),
    },
    {
      key: "usageOrgs",
      header: t("bankAccounts.columns.usageOrgs"),
      render: (row) => {
        const text = usageText(row, t);
        return text === "" ? "—" : text;
      },
    },
    {
      key: "balance",
      header: t("bankAccounts.columns.balance"),
      align: "right",
      render: (row) => (
        <Typography
          variant="body2"
          color={row.balance < 0 ? "warning.main" : "text.primary"}
          {...(row.balance < 0 ? { title: t("bankAccounts.negative") } : {})}
        >
          {moneyText(row.balance)}
        </Typography>
      ),
    },
    {
      key: "status",
      header: t("bankAccounts.columns.status"),
      width: 96,
      render: (row) => (
        <Tag
          tone={row.status === "active" ? "success" : "grey"}
          label={t(`status.${row.status === "active" ? "active" : "inactive"}`)}
        />
      ),
    },
  ];

  return (
    <Box sx={{ flex: 1, minHeight: 0 }}>
      <Table
        aria-label={t("bankAccounts.listAria")}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        isLoading={query.isLoading}
        emptyMessage={t("bankAccounts.empty")}
        minWidth={BANK_ACCOUNTS_TABLE_MIN_WIDTH}
        {...(access.viewRoute === null
          ? {}
          : {
              onRowClick: (row: LotteryBankAccountFieldsFragment) => {
                void navigate(`${access.viewRoute ?? ""}/${row.id}`);
              },
            })}
      />
      {isCreating && <BankAccountDialog onClose={onCloseCreate} />}
    </Box>
  );
};
