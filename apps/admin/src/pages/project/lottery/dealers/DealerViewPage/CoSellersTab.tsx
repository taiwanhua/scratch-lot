import { useTranslations } from "use-intl";

import {
  type LotteryDealerCoSellersQuery,
  useLotteryDealerCoSellersQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { DEALER_STATUS_LABELS, DEALER_STATUS_TONES } from "../dealer-labels";
import { CO_SELLER_WARNING_OVER } from "../dealers-keys";
import type { DealerDetailTabProps } from "./dealer-detail-tabs";

type CoSellerRow =
  LotteryDealerCoSellersQuery["lotteryDealerCoSellers"]["items"][number];

/**
 * 共同銷售人(乙類詳情頁;規格 5.2、Figma DE-05):把這位乙類設為共同銷售處所的甲類(反查);
 * 超過 6 位只警告。
 */
export const CoSellersTab = ({ dealer }: DealerDetailTabProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const temporal = useTemporalText();
  const query = useLotteryDealerCoSellersQuery(session.client, {
    dealerId: dealer.id,
  });
  const rows = query.data?.lotteryDealerCoSellers.items ?? [];

  const columns: DataTableColumn<CoSellerRow>[] = [
    {
      key: "licenseNo",
      header: t("coSellers.licenseNo"),
      width: 130,
      accessor: (row) => row.dealer.licenseNo,
    },
    {
      key: "name",
      header: t("coSellers.name"),
      width: 130,
      accessor: (row) => row.dealer.name,
    },
    {
      key: "registeredAt",
      header: t("coSellers.registeredAt"),
      width: 130,
      accessor: (row) => temporal(row.registeredAt, "date"),
    },
    {
      key: "status",
      header: t("coSellers.status"),
      width: 100,
      render: ({ row }) => (
        <Tag
          tone={DEALER_STATUS_TONES[row.dealer.status]}
          label={t(DEALER_STATUS_LABELS[row.dealer.status])}
        />
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      {rows.length > CO_SELLER_WARNING_OVER && (
        <Alert severity="warning">
          {t("detail.coSellerWarning", { count: String(rows.length) })}
        </Alert>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.dealer.id}
        isLoading={query.isLoading}
        emptyMessage={t("common.empty")}
        size="small"
        aria-label={t("coSellers.tab")}
      />
    </Stack>
  );
};
