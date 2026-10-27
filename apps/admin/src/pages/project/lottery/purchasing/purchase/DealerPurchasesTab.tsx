import { useTranslations } from "use-intl";

import {
  type FormSubmissionStatus,
  type LotteryDealerPurchasesQuery,
  useLotteryDealerPurchasesQuery,
} from "@repo/graphql";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";

import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import type { DealerDetailTabProps } from "@/pages/project/lottery/dealers/DealerViewPage/dealer-detail-tabs";

import { formatMoney } from "./purchase-keys";

type PurchaseRow =
  LotteryDealerPurchasesQuery["lotteryDealerPurchases"][number];

/**
 * 甲類詳情「批購紀錄」分頁(規格 5.2;進貨單追加到經銷商詳情的分頁登記):這位甲類在有效進貨單
 * (送出之後、沒有駁回 / 作廢)的批購,批購日新到舊。
 */
export const DealerPurchasesTab = ({ dealer }: DealerDetailTabProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.dealerTab");
  const { session } = useSession();
  const temporal = useTemporalText();
  const timezone = useTenantTimezone() ?? undefined;
  const query = useLotteryDealerPurchasesQuery(session.client, {
    dealerId: dealer.id,
  });
  const rows = query.data?.lotteryDealerPurchases ?? [];
  const columns: DataTableColumn<PurchaseRow>[] = [
    {
      key: "serialNo",
      header: t("serialNo"),
      width: 100,
      accessor: (row) => row.serialNo ?? "—",
    },
    {
      key: "purchaseDate",
      header: t("purchaseDate"),
      width: 110,
      accessor: (row) =>
        row.purchaseDate === null || row.purchaseDate === undefined
          ? "—"
          : temporal(row.purchaseDate, "date", timezone),
    },
    {
      key: "branchName",
      header: t("branch"),
      width: 120,
      accessor: (row) => row.branchName,
    },
    {
      key: "who",
      header: t("who"),
      width: 140,
      accessor: (row) =>
        row.selfPurchase
          ? t("self")
          : t("trustee", { name: row.trusteeName ?? "—" }),
    },
    {
      key: "books",
      header: t("books"),
      width: 80,
      accessor: (row) => String(row.books),
    },
    {
      key: "purchaseTotal",
      header: t("purchaseTotal"),
      width: 110,
      accessor: (row) => formatMoney(row.purchaseTotal),
    },
    {
      key: "status",
      header: t("status"),
      width: 100,
      accessor: (row) => row.status,
      render: ({ row }) => (
        <SubmissionStatusTag
          status={row.status.toUpperCase() as FormSubmissionStatus}
          blocked={false}
        />
      ),
    },
  ];
  return (
    <DataTable
      aria-label={t("aria")}
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.purchaseId}
      isLoading={query.isLoading}
      emptyMessage={t("empty")}
    />
  );
};
