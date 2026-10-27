import { useTranslations } from "use-intl";

import {
  type LotteryDealerFieldsFragment,
  LotteryDealerType,
  useLotteryDealersQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { urlStateDefault } from "@/lib/base/url-state";

import { DEALER_STATUS_LABELS, DEALER_STATUS_TONES } from "../dealer-labels";
import { CO_SELLER_WARNING_OVER, DEALERS_PAGE_SIZE } from "../dealers-keys";
import {
  type ClassBListFilters,
  DEALERS_LIST_KEY,
  LICENSE_FILTER,
  classBListSchema,
} from "../dealers-list";
import type { DealersTabProps } from "./ClassADealersTab";
import { DealersPager } from "./DealersPager";
import { LicenseExpiryTag } from "./LicenseExpiryTag";

const listDefault = urlStateDefault(classBListSchema);

/**
 * 乙類分頁(Figma DE-02):快速篩選 證照 30 天內到期 / 證照已過期 + 證照篩選、關鍵字(同甲類);
 * 欄位 證號、店名、姓名、對應分店(未選警告色)、共同銷售人 N/6(超過 6 紅字,只警告)、證照到期、狀態。
 */
export const ClassBDealersTab = ({ access }: DealersTabProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const [filters, setFilters] = useUrlState(DEALERS_LIST_KEY, classBListSchema);
  const list = useLotteryDealersQuery(session.client, {
    input: {
      type: LotteryDealerType.B,
      licenseState: LICENSE_FILTER[filters.license],
      keyword: filters.keyword === "" ? null : filters.keyword,
      page: filters.page,
      pageSize: DEALERS_PAGE_SIZE,
    },
  });
  const rows = list.data?.lotteryDealers.items ?? [];

  const set = (patch: Partial<ClassBListFilters>) => {
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  };

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
      key: "licenseExpiresAt",
      header: t("list.columns.licenseExpiresAt"),
      width: 120,
      render: ({ row }) => <LicenseExpiryTag dealer={row} />,
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

  const quick = [
    {
      key: "licenseExpiring",
      label: t("list.quick.licenseExpiring"),
      isOn: filters.license === "expiring",
      patch: { license: filters.license === "expiring" ? "all" : "expiring" },
    },
    {
      key: "licenseExpired",
      label: t("list.quick.licenseExpired"),
      isOn: filters.license === "expired",
      patch: { license: filters.license === "expired" ? "all" : "expired" },
    },
  ] as const;

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        {quick.map((chip) => (
          <Button
            key={chip.key}
            size="small"
            variant={chip.isOn ? "contained" : "outlined"}
            aria-pressed={chip.isOn}
            onClick={() => {
              set(chip.patch);
            }}
          >
            {chip.label}
          </Button>
        ))}
      </Stack>
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1.5, flexWrap: "wrap" }}
      >
        <SelectField<ClassBListFilters["license"]>
          label={t("list.filters.license")}
          value={filters.license}
          size="small"
          sx={{ width: 180 }}
          options={[
            { value: "all", label: t("common.all") },
            { value: "expiring", label: t("list.filters.licenseExpiring") },
            { value: "expired", label: t("list.filters.licenseExpired") },
          ]}
          onChange={(license) => {
            set({ license });
          }}
        />
        <TextField
          label={t("list.filters.classBKeyword")}
          value={filters.keyword}
          size="small"
          sx={{ width: { xs: "100%", sm: 260 } }}
          onChange={(event) => {
            set({ keyword: event.target.value });
          }}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          variant="text"
          onClick={() => {
            setFilters(listDefault);
          }}
        >
          {t("actions.clear")}
        </Button>
      </Stack>
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
          setFilters((current) => ({ ...current, page }));
        }}
      />
    </Stack>
  );
};
