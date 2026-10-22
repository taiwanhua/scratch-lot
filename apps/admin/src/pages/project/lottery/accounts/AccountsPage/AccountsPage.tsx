import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { useUrlState } from "@/hooks/base/useUrlState";

import { BankAccountsTab } from "../BankAccountsTab/BankAccountsTab";
import { CashLedgerTab } from "../CashLedgerTab/CashLedgerTab";
import { OutstandingTab } from "../OutstandingTab/OutstandingTab";
import { PeriodCloseTab } from "../PeriodCloseTab/PeriodCloseTab";
import { ACCOUNTS_PERMISSIONS, ACCOUNTS_TABS } from "../accounts-config";
import { useAccountsAccess } from "../useAccountsAccess";

/** 與 `PageTabs` 同一個 `?tab=`(只讀,決定右上角有沒有 [+ 新增帳戶])。 */
const tabSchema = z.string().default("");

/**
 * 帳戶管理(`accounts`,規格 3.1 / 10;Figma AC-01 93:17、AC-04 93:834、AC-05 93:1143、AC-06 93:1417):
 * 分頁 銀行帳戶 | 即時現金帳 | 待結清款項 | 關帳(前三個各要一條 `view-*` 權限,關帳要 `close-period`)。
 * 右上 [+ 新增帳戶] 只在銀行帳戶分頁、且有 `create-bank-account` 時出現。
 */
export const AccountsPage = () => {
  const t = useTranslations("admin.lotteryAccounts");
  const access = useAccountsAccess();
  const [tab] = useUrlState("tab", tabSchema);
  const [isCreating, setCreating] = useState(false);

  const items: PageTabItem[] = [
    {
      value: ACCOUNTS_TABS.bankAccounts,
      label: t("tabs.bankAccounts"),
      permission: ACCOUNTS_PERMISSIONS.viewBankAccounts,
      content: (
        <BankAccountsTab
          isCreating={isCreating}
          onCloseCreate={() => {
            setCreating(false);
          }}
        />
      ),
    },
    {
      value: ACCOUNTS_TABS.cash,
      label: t("tabs.cash"),
      permission: ACCOUNTS_PERMISSIONS.viewCash,
      content: <CashLedgerTab />,
    },
    {
      value: ACCOUNTS_TABS.outstanding,
      label: t("tabs.outstanding"),
      permission: ACCOUNTS_PERMISSIONS.viewOutstanding,
      content: <OutstandingTab />,
    },
    {
      value: ACCOUNTS_TABS.close,
      label: t("tabs.close"),
      permission: ACCOUNTS_PERMISSIONS.closePeriod,
      content: <PeriodCloseTab />,
    },
  ];
  const canSee: Record<string, boolean> = {
    [ACCOUNTS_TABS.bankAccounts]: access.canViewBankAccounts,
    [ACCOUNTS_TABS.cash]: access.canViewCash,
    [ACCOUNTS_TABS.outstanding]: access.canViewOutstanding,
    [ACCOUNTS_TABS.close]: access.canClosePeriod,
  };
  const visible = items.filter((item) => canSee[item.value] ?? false);
  const currentTab =
    visible.find((item) => item.value === tab)?.value ?? visible[0]?.value;
  const action =
    currentTab === ACCOUNTS_TABS.bankAccounts && access.canCreateAccount ? (
      <Button
        onClick={() => {
          setCreating(true);
        }}
      >
        {t("bankAccounts.new")}
      </Button>
    ) : null;

  return (
    // 頁內分頁殼(STYLE-08):內容少時撐滿、多時跟著長,交給 <main> 捲;不釘高(Card 預設 overflow: hidden,釘高會裁掉內容)
    <Card
      sx={{
        flexGrow: 1,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        px: { xs: 2, sm: 3 },
        py: 2,
      }}
    >
      <PageTabs aria-label={t("tabs.aria")} items={items} actions={action} />
    </Card>
  );
};
