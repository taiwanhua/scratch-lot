import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type LotteryWholesaleFieldsFragment,
  useLotteryCustomerWholesalesQuery,
} from "@repo/graphql";
import type { TableColumn } from "@repo/ui/table";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useSession } from "@/hooks/base/useSession";
import { AccountsList } from "@/pages/project/lottery/accounts/AccountsList/AccountsList";
import type { WholesaleCustomerDetailTabProps } from "@/pages/project/lottery/dealers/WholesaleCustomerViewPage/wholesale-customer-detail-tabs";

import { WHOLESALE_MODULE_KEY, formatMoney } from "./wholesale-keys";

/**
 * 批售客戶詳情「批售紀錄」分頁(規格 21.2;批售單追加到批售客戶詳情的分頁登記;Figma DE-10b):這位客戶的批售單
 * (讀得到的;草稿只有自己的),新的在前;點一筆進批售單(有模組時)。
 */
export const CustomerWholesalesTab = ({
  customer,
}: WholesaleCustomerDetailTabProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale");
  const navigate = useNavigate();
  const { session } = useSession();
  const access = useFormModuleAccess(WHOLESALE_MODULE_KEY);
  const query = useLotteryCustomerWholesalesQuery(session.client, {
    customerId: customer.id,
  });
  const columns: TableColumn<LotteryWholesaleFieldsFragment>[] = [
    {
      key: "serialNo",
      header: t("list.columns.serialNo"),
      isEmphasized: true,
      render: (row) => row.serialNo ?? "—",
    },
    {
      key: "fromBranch",
      header: t("list.columns.fromBranch"),
      render: (row) => row.fromBranchName,
    },
    {
      key: "books",
      header: t("list.columns.books"),
      align: "right",
      render: (row) => t("list.books", { count: row.books }),
    },
    {
      key: "amount",
      header: t("list.columns.amount"),
      align: "right",
      render: (row) => formatMoney(row.amount),
    },
    {
      key: "received",
      header: t("customerTab.received"),
      align: "right",
      render: (row) => formatMoney(row.received),
    },
    {
      key: "status",
      header: t("list.columns.status"),
      render: (row) => (
        <SubmissionStatusTag status={row.status} blocked={row.blocked} />
      ),
    },
  ];
  const { viewRoute } = access;
  return (
    <AccountsList
      aria-label={t("customerTab.aria")}
      columns={columns}
      rows={query.data?.lotteryCustomerWholesales ?? []}
      getRowKey={(row) => row.id}
      isLoading={query.isLoading}
      emptyMessage={t("customerTab.empty")}
      containerSx={{ height: "auto" }}
      card={{ title: ["serialNo"], tag: "status" }}
      {...(viewRoute === null
        ? {}
        : {
            onRowClick: (row: LotteryWholesaleFieldsFragment) => {
              void navigate(`${viewRoute}/${row.id}`);
            },
          })}
    />
  );
};
