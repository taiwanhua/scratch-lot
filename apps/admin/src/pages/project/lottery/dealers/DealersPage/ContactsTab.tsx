import { useTranslations } from "use-intl";

import {
  type LotteryContactRole,
  LotteryContactStatus,
  type LotteryDealerContactFieldsFragment,
  useLotteryDealerContactsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";

import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";

import {
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  CONTACT_STATUS_LABELS,
} from "../dealer-labels";
import { DEALERS_PAGE_SIZE } from "../dealers-keys";
import { DEALERS_LIST_KEY, contactsListSchema } from "../dealers-list";
import type { DealersTabProps } from "./ClassADealersTab";
import { DealersPager } from "./DealersPager";

const ALL = "" as const;

/**
 * 關係人分頁(Figma DE-07):篩選 身分、狀態、關鍵字(姓名、手機、身分證);
 * 欄位 姓名、身分標籤、手機、狀態、關聯經銷商數。點一列進關係人詳情頁。
 */
export const ContactsTab = ({ access }: DealersTabProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const [filters, setFilters] = useUrlState(
    DEALERS_LIST_KEY,
    contactsListSchema,
  );
  const list = useLotteryDealerContactsQuery(session.client, {
    input: {
      role: filters.role,
      status: filters.status,
      keyword: filters.keyword === "" ? null : filters.keyword,
      page: filters.page,
      pageSize: DEALERS_PAGE_SIZE,
    },
  });
  const rows = list.data?.lotteryDealerContacts.items ?? [];

  const columns: DataTableColumn<LotteryDealerContactFieldsFragment>[] = [
    {
      key: "name",
      header: t("list.columns.name"),
      width: 120,
      isEmphasized: true,
      accessor: (row) => row.name,
    },
    {
      key: "roles",
      header: t("list.columns.roles"),
      width: 200,
      render: ({ row }) => (
        <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
          {row.roles.map((role) => (
            <Tag key={role} label={t(CONTACT_ROLE_LABELS[role])} />
          ))}
        </Stack>
      ),
    },
    {
      key: "mobile",
      header: t("list.columns.mobile"),
      width: 130,
      accessor: (row) => row.mobile ?? t("common.none"),
    },
    {
      key: "status",
      header: t("list.columns.status"),
      width: 90,
      render: ({ row }) => (
        <Tag
          tone={row.status === LotteryContactStatus.Active ? "success" : "grey"}
          label={t(CONTACT_STATUS_LABELS[row.status])}
        />
      ),
    },
    {
      key: "dealerCount",
      header: t("list.columns.dealerCount"),
      width: 110,
      accessor: (row) => String(row.dealerCount),
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1.5, flexWrap: "wrap" }}
      >
        <SelectField<LotteryContactRole | typeof ALL>
          label={t("list.filters.role")}
          value={filters.role ?? ALL}
          displayEmpty
          size="small"
          sx={{ width: 160 }}
          options={[
            { value: ALL, label: t("common.all") },
            ...CONTACT_ROLES.map((role) => ({
              value: role,
              label: t(CONTACT_ROLE_LABELS[role]),
            })),
          ]}
          onChange={(next) => {
            setFilters((current) => ({
              ...current,
              role: next === ALL ? null : next,
              page: 1,
            }));
          }}
        />
        <SelectField<LotteryContactStatus | typeof ALL>
          label={t("list.filters.status")}
          value={filters.status ?? ALL}
          displayEmpty
          size="small"
          sx={{ width: 140 }}
          options={[
            { value: ALL, label: t("common.all") },
            ...[LotteryContactStatus.Active, LotteryContactStatus.Disabled].map(
              (status) => ({
                value: status,
                label: t(CONTACT_STATUS_LABELS[status]),
              }),
            ),
          ]}
          onChange={(next) => {
            setFilters((current) => ({
              ...current,
              status: next === ALL ? null : next,
              page: 1,
            }));
          }}
        />
        <TextField
          label={t("list.filters.contactKeyword")}
          value={filters.keyword}
          size="small"
          sx={{ width: { xs: "100%", sm: 260 } }}
          onChange={(event) => {
            setFilters((current) => ({
              ...current,
              keyword: event.target.value,
              page: 1,
            }));
          }}
        />
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={t("common.empty")}
          size="small"
          aria-label={t("list.tableAria.contacts")}
          onRowClick={
            access.routes.contactView === null
              ? undefined
              : (row) => {
                  access.goTo(access.routes.contactView, row.id);
                }
          }
        />
      </Box>
      <DealersPager
        totalCount={list.data?.lotteryDealerContacts.totalCount ?? 0}
        page={filters.page}
        onPageChange={(page) => {
          setFilters((current) => ({ ...current, page }));
        }}
      />
    </Stack>
  );
};
