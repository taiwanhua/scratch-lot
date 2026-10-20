import { useTranslations } from "use-intl";

import {
  type LotteryDealerFieldsFragment,
  LotteryDealerType,
  LotteryLicenseState,
  useLotteryDealersQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";

import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { urlStateDefault } from "@/lib/base/url-state";

import {
  DEALER_STATUS_LABELS,
  DEALER_STATUS_TONES,
  purchaseTone,
} from "../dealer-labels";
import { DEALERS_PAGE_SIZE } from "../dealers-keys";
import {
  type ClassAListFilters,
  DEALERS_LIST_KEY,
  classAListSchema,
} from "../dealers-list";
import type { DealersAccess } from "../useDealersAccess";
import { DealersPager } from "./DealersPager";

const LICENSE_FILTER: Record<
  ClassAListFilters["license"],
  LotteryLicenseState | undefined
> = {
  all: undefined,
  expiring: LotteryLicenseState.Expiring,
  expired: LotteryLicenseState.Expired,
};

const SIGNIN_FILTER: Record<ClassAListFilters["signin"], boolean | undefined> =
  {
    all: undefined,
    signed: true,
    unsigned: false,
  };

const PURCHASE_FILTER: Record<
  ClassAListFilters["purchase"],
  number | undefined
> = {
  all: undefined,
  "150": 150,
  "180": 180,
};

const listDefault = urlStateDefault(classAListSchema);

export interface DealersTabProps {
  access: DealersAccess;
}

/**
 * 甲類分頁(Figma DE-01):快速篩選 逾 150 天 / 逾 180 天 / 本季未見簽 + 三個篩選(見簽狀態、距上次批購、證照);
 * 欄位 證號、姓名、共同銷售處所、距批購 N 天、距本人批購 N 天、本季見簽、狀態。點一列進詳情頁。
 */
export const ClassADealersTab = ({ access }: DealersTabProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const [filters, setFilters] = useUrlState(DEALERS_LIST_KEY, classAListSchema);
  const list = useLotteryDealersQuery(session.client, {
    input: {
      type: LotteryDealerType.A,
      currentQuarterSigned: SIGNIN_FILTER[filters.signin],
      purchaseOverDays: PURCHASE_FILTER[filters.purchase],
      licenseState: LICENSE_FILTER[filters.license],
      page: filters.page,
      pageSize: DEALERS_PAGE_SIZE,
    },
  });
  const rows = list.data?.lotteryDealers.items ?? [];

  const set = (patch: Partial<ClassAListFilters>) => {
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  };

  const daysTag = (days: number | null) => (
    <Tag
      tone={purchaseTone(days)}
      label={
        days === null
          ? t("common.noRecord")
          : t("common.days", { days: String(days) })
      }
    />
  );

  const columns: DataTableColumn<LotteryDealerFieldsFragment>[] = [
    {
      key: "licenseNo",
      header: t("list.columns.licenseNo"),
      width: 120,
      accessor: (row) => row.licenseNo,
    },
    {
      key: "name",
      header: t("list.columns.name"),
      width: 120,
      isEmphasized: true,
      accessor: (row) => row.name,
    },
    {
      key: "coSales",
      header: t("list.columns.coSalesStore"),
      width: 170,
      accessor: (row) =>
        row.coSalesDealer?.storeName ??
        row.coSalesDealer?.name ??
        t("common.none"),
    },
    {
      key: "days",
      header: t("list.columns.daysSincePurchase"),
      width: 110,
      render: ({ row }) => daysTag(row.daysSinceLastPurchase ?? null),
    },
    {
      key: "selfDays",
      header: t("list.columns.daysSinceSelfPurchase"),
      width: 120,
      render: ({ row }) => daysTag(row.daysSinceLastSelfPurchase ?? null),
    },
    {
      key: "signed",
      header: t("list.columns.signedThisQuarter"),
      width: 110,
      render: ({ row }) =>
        row.currentQuarterSigned === true ? (
          <Tag tone="success" label={t("list.signed")} />
        ) : (
          <Tag tone="warning" label={t("list.unsigned")} />
        ),
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
      key: "over150",
      label: t("list.quick.over150"),
      isOn: filters.purchase === "150",
      patch: { purchase: filters.purchase === "150" ? "all" : "150" },
    },
    {
      key: "over180",
      label: t("list.quick.over180"),
      isOn: filters.purchase === "180",
      patch: { purchase: filters.purchase === "180" ? "all" : "180" },
    },
    {
      key: "unsigned",
      label: t("list.quick.unsignedThisQuarter"),
      isOn: filters.signin === "unsigned",
      patch: { signin: filters.signin === "unsigned" ? "all" : "unsigned" },
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
        <SelectField<ClassAListFilters["signin"]>
          label={t("list.filters.signin")}
          value={filters.signin}
          size="small"
          sx={{ width: 180 }}
          options={[
            { value: "all", label: t("common.all") },
            { value: "signed", label: t("list.filters.signed") },
            { value: "unsigned", label: t("list.filters.unsigned") },
          ]}
          onChange={(signin) => {
            set({ signin });
          }}
        />
        <SelectField<ClassAListFilters["purchase"]>
          label={t("list.filters.purchase")}
          value={filters.purchase}
          size="small"
          sx={{ width: 180 }}
          options={[
            { value: "all", label: t("common.all") },
            { value: "150", label: t("list.quick.over150") },
            { value: "180", label: t("list.quick.over180") },
          ]}
          onChange={(purchase) => {
            set({ purchase });
          }}
        />
        <SelectField<ClassAListFilters["license"]>
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
          aria-label={t("list.tableAria.classA")}
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
