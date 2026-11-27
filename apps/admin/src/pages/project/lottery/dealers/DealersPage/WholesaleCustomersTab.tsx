import { useTranslations } from "use-intl";

import {
  type LotteryWholesaleCustomerFieldsFragment,
  type LotteryWholesaleCustomerStatus,
  useLotteryWholesaleCustomersQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import type { TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";

import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";
import { AccountsList } from "@/pages/project/lottery/accounts/AccountsList/AccountsList";

import { DEALERS_PAGE_SIZE } from "../dealers-keys";
import {
  DEALERS_LIST_KEY,
  wholesaleCustomersListSchema,
} from "../dealers-list";
import {
  WHOLESALE_CUSTOMER_STATUSES,
  WHOLESALE_CUSTOMER_STATUS_LABELS,
  WHOLESALE_CUSTOMER_STATUS_TONES,
} from "../wholesale-customer-labels";
import type { DealersTabProps } from "./ClassADealersTab";
import { DealersPager } from "./DealersPager";

const ALL = "" as const;
const TABLE_MIN_WIDTH = 720;

/**
 * 批售客戶分頁(規格 21.2;Figma DE-09):篩選 狀態、關鍵字(店名、證號、聯絡人、電話);
 * 欄位 店名、證號、聯絡人、電話、狀態、最近一次批售日(沒有 = 無紀錄)。點一列進批售客戶詳情頁。
 * 平板 / 手機的狀態收進 [篩選] 抽屜,手機每列一張卡片。
 */
export const WholesaleCustomersTab = ({ access }: DealersTabProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const temporal = useTemporalText();
  const [filters, setFilters] = useUrlState(
    DEALERS_LIST_KEY,
    wholesaleCustomersListSchema,
  );
  const list = useLotteryWholesaleCustomersQuery(session.client, {
    input: {
      status: filters.status,
      keyword: filters.keyword === "" ? null : filters.keyword,
      page: filters.page,
      pageSize: DEALERS_PAGE_SIZE,
    },
  });
  const none = t("common.none");
  const { wholesaleCustomerView } = access.routes;

  const columns: TableColumn<LotteryWholesaleCustomerFieldsFragment>[] = [
    {
      key: "storeName",
      header: t("wholesale.fields.storeName"),
      isEmphasized: true,
      render: (row) => row.storeName,
    },
    {
      key: "licenseNo",
      header: t("wholesale.fields.licenseNo"),
      render: (row) => row.licenseNo ?? none,
    },
    {
      key: "contactName",
      header: t("wholesale.fields.contactName"),
      render: (row) => row.contactName ?? none,
    },
    {
      key: "phone",
      header: t("wholesale.fields.phone"),
      render: (row) => row.phone ?? none,
    },
    {
      key: "status",
      header: t("wholesale.fields.status"),
      render: (row) => (
        <Tag
          tone={WHOLESALE_CUSTOMER_STATUS_TONES[row.status]}
          label={t(WHOLESALE_CUSTOMER_STATUS_LABELS[row.status])}
        />
      ),
    },
    {
      key: "lastWholesaleAt",
      header: t("wholesale.fields.lastWholesaleAt"),
      render: (row) =>
        row.lastWholesaleAt == null
          ? t("common.noRecord")
          : temporal(row.lastWholesaleAt, "date"),
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <FilterDrawer<LotteryWholesaleCustomerStatus | null>
        value={filters.status}
        emptyValue={null}
        activeCount={filters.status === null ? 0 : 1}
        onApply={(status) => {
          setFilters((current) => ({ ...current, status, page: 1 }));
        }}
        renderFields={(value, change) => (
          <SelectField<LotteryWholesaleCustomerStatus | typeof ALL>
            label={t("wholesale.fields.status")}
            value={value ?? ALL}
            displayEmpty
            size="small"
            sx={{ minWidth: 140 }}
            options={[
              { value: ALL, label: t("common.all") },
              ...WHOLESALE_CUSTOMER_STATUSES.map((status) => ({
                value: status,
                label: t(WHOLESALE_CUSTOMER_STATUS_LABELS[status]),
              })),
            ]}
            onChange={(next) => {
              change(next === ALL ? null : next);
            }}
          />
        )}
        search={
          <TextField
            label={t("wholesale.keyword")}
            value={filters.keyword}
            size="small"
            sx={{ minWidth: { xs: 0, lg: 320 }, flex: { xs: 1, lg: "none" } }}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                keyword: event.target.value,
                page: 1,
              }));
            }}
          />
        }
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <AccountsList
          columns={columns}
          rows={list.data?.lotteryWholesaleCustomers.items ?? []}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={t("common.empty")}
          minWidth={TABLE_MIN_WIDTH}
          aria-label={t("wholesale.listAria")}
          card={{ title: ["storeName"], tag: "status" }}
          {...(wholesaleCustomerView === null
            ? {}
            : {
                onRowClick: (row: LotteryWholesaleCustomerFieldsFragment) => {
                  access.goTo(wholesaleCustomerView, row.id);
                },
              })}
        />
      </Box>
      <DealersPager
        totalCount={list.data?.lotteryWholesaleCustomers.totalCount ?? 0}
        page={filters.page}
        onPageChange={(page) => {
          setFilters((current) => ({ ...current, page }));
        }}
      />
    </Stack>
  );
};
