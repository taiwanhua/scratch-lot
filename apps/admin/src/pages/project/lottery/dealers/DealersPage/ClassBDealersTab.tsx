import { useTranslations } from "use-intl";

import {
  type LotteryDealerFieldsFragment,
  LotteryDealerType,
  useLotteryDealersQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";

import { DEALER_STATUS_LABELS, DEALER_STATUS_TONES } from "../dealer-labels";
import { CO_SELLER_WARNING_OVER, DEALERS_PAGE_SIZE } from "../dealers-keys";
import { DEALERS_LIST_KEY, classBListSchema } from "../dealers-list";
import type { DealersTabProps } from "./ClassADealersTab";
import { DealersPager } from "./DealersPager";

/**
 * 乙類分頁(Figma DE-02):證號、店名、姓名、對應分店(未選警告色)、共同銷售人 N/6(超過 6 紅字,只警告)、狀態。
 */
export const ClassBDealersTab = ({ access }: DealersTabProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const [filters, setFilters] = useUrlState(DEALERS_LIST_KEY, classBListSchema);
  const list = useLotteryDealersQuery(session.client, {
    input: {
      type: LotteryDealerType.B,
      page: filters.page,
      pageSize: DEALERS_PAGE_SIZE,
    },
  });
  const rows = list.data?.lotteryDealers.items ?? [];

  const columns: DataTableColumn<LotteryDealerFieldsFragment>[] = [
    {
      key: "licenseNo",
      header: t("list.columns.licenseNo"),
      width: 120,
      accessor: (row) => row.licenseNo,
    },
    {
      key: "storeName",
      header: t("list.columns.storeName"),
      width: 150,
      isEmphasized: true,
      accessor: (row) => row.storeName ?? t("common.none"),
    },
    {
      key: "name",
      header: t("list.columns.name"),
      width: 120,
      accessor: (row) => row.name,
    },
    {
      key: "storeOrg",
      header: t("list.columns.storeOrg"),
      width: 130,
      render: ({ row }) =>
        row.storeOrg === null || row.storeOrg === undefined ? (
          <Typography variant="body2" color="warning">
            {t("list.storeOrgMissing")}
          </Typography>
        ) : (
          row.storeOrg.name
        ),
    },
    {
      key: "coSellers",
      header: t("list.columns.coSellers"),
      width: 110,
      render: ({ row }) => {
        const count = row.coSellerCount ?? 0;
        return (
          <Typography
            variant="body2"
            color={count > CO_SELLER_WARNING_OVER ? "error" : undefined}
          >
            {t("list.coSellerCount", { count: String(count) })}
          </Typography>
        );
      },
    },
    {
      key: "status",
      header: t("list.columns.status"),
      width: 100,
      render: ({ row }) => (
        <Tag
          tone={DEALER_STATUS_TONES[row.status]}
          label={t(DEALER_STATUS_LABELS[row.status])}
        />
      ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={t("common.empty")}
          size="small"
          aria-label={t("list.tableAria.classB")}
          onRowClick={
            access.routes.view === null
              ? undefined
              : (row) => {
                  access.goTo(access.routes.view, row.id);
                }
          }
        />
      </Box>
      <DealersPager
        totalCount={list.data?.lotteryDealers.totalCount ?? 0}
        page={filters.page}
        onPageChange={(page) => {
          setFilters({ page });
        }}
      />
    </Stack>
  );
};
