import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type FormSubmissionStatus,
  type LotteryWholesaleFieldsFragment,
  useLotteryWholesaleCustomerFilterQuery,
  useLotteryWholesalesQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Pagination } from "@repo/ui/pagination";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import type { TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useFormEntry } from "@/components/base/form-engine/FormModulePages/useFormEntry";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { LIST_PAGE_SHELL_SX } from "@/lib/base/list-page-layout";
import { AccountsList } from "@/pages/project/lottery/accounts/AccountsList/AccountsList";

import { REQUISITION_STATUS_ORDER } from "../../RequisitionsTab/requisitions";
import { SubmissionDeleteButton } from "../../shared/SubmissionDeleteButton";
import {
  WHOLESALE_FORM_KEY,
  WHOLESALE_LIST_KEY,
  WHOLESALE_MODULE_KEY,
  WHOLESALE_PAGE_SIZE,
  WHOLESALE_PAYMENT_MODES,
  type WholesaleListFilters,
  formatMoney,
  wholesaleListSchema,
} from "../wholesale-keys";

const ALL = "all" as const;
/** 表格最小寬(平板窄時在卡片裡橫捲)。 */
const TABLE_MIN_WIDTH = 920;

type Row = LotteryWholesaleFieldsFragment;
type Filters = Omit<WholesaleListFilters, "page">;

const EMPTY_FILTERS: Filters = {
  status: null,
  fromOrgId: null,
  customerId: null,
  paymentMode: null,
};

/** 結算欄:待收 / 待退 N(標色)、已結清;沒參與收付(草稿、核准前的從帳戶入帳、駁回、作廢)= 「—」。 */
const SettlementCell = ({ row }: { row: Row }) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.list");
  if (!row.inSettlement) {
    return <>—</>;
  }
  return row.settlementKind == null ? (
    <>{t("cleared")}</>
  ) : (
    <Tag
      tone="warning"
      label={t(`kinds.${row.settlementKind}`, {
        amount: formatMoney(row.settlementAmount),
      })}
    />
  );
};

/**
 * 批售單(`purchasing.wholesale`,表單模組的列表頁;規格 21.3「列表」;Figma WS-01 914:8490 / 960:12386 / 960:12560、
 * WS-01b 篩選抽屜):單號、出貨分店、批售客戶(店名)、收款方式、本數、批售金額、結算、狀態;
 * 篩選 出貨分店、批售客戶、收款方式、狀態(含草稿)。篩選要進後端的分頁,列由 `lotteryWholesales` 給(不走表單列表)。
 */
export const WholesalePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.list");
  const tModes = useTranslations(
    "admin.lotteryPurchasing.wholesale.paymentModes",
  );
  const tStatus = useTranslations("admin.approval.submissionStatus");
  const navigate = useNavigate();
  const { session } = useSession();
  const entry = useFormEntry(WHOLESALE_MODULE_KEY, WHOLESALE_FORM_KEY);
  const { access, canCreate } = entry;
  const [{ page, ...filters }, setFilters] = useUrlState(
    WHOLESALE_LIST_KEY,
    wholesaleListSchema,
  );
  const query = useLotteryWholesalesQuery(session.client, {
    input: { ...filters, page, pageSize: WHOLESALE_PAGE_SIZE },
  });
  const customers = useLotteryWholesaleCustomerFilterQuery(session.client);
  const totalCount = query.data?.lotteryWholesales.totalCount ?? 0;

  const columns: TableColumn<Row>[] = [
    {
      key: "serialNo",
      header: t("columns.serialNo"),
      isEmphasized: true,
      render: (row) => row.serialNo ?? "—",
    },
    {
      key: "fromBranch",
      header: t("columns.fromBranch"),
      render: (row) => row.fromBranchName,
    },
    {
      key: "customer",
      header: t("columns.customer"),
      render: (row) => row.customerName,
    },
    {
      key: "paymentMode",
      header: t("columns.paymentMode"),
      render: (row) =>
        row.paymentMode == null ? "—" : tModes(row.paymentMode),
    },
    {
      key: "books",
      header: t("columns.books"),
      render: (row) => t("books", { count: row.books }),
    },
    {
      key: "amount",
      header: t("columns.amount"),
      align: "right",
      render: (row) => formatMoney(row.amount),
    },
    {
      key: "settlement",
      header: t("columns.settlement"),
      render: (row) => <SettlementCell row={row} />,
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (row) => (
        <SubmissionStatusTag status={row.status} blocked={row.blocked} />
      ),
    },
    {
      key: "delete",
      header: "",
      width: 80,
      render: (row) => (
        <SubmissionDeleteButton
          moduleKey={WHOLESALE_MODULE_KEY}
          id={row.id}
          label={row.serialNo ?? row.customerName}
          status={row.status}
          canDelete={row.canDelete}
        />
      ),
    },
  ];

  return (
    // 列表頁殼(STYLE-08):平板以上且視窗夠高時釘高、表格在卡片裡捲(表頭固定);手機寬與矮視窗不釘高,整頁捲
    <Card
      sx={[
        LIST_PAGE_SHELL_SX,
        {
          display: "flex",
          flexDirection: "column",
          px: { xs: 2, sm: 3 },
          py: 2,
        },
      ]}
    >
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="h6" component="h1" sx={{ flex: 1 }}>
            {t("title")}
          </Typography>
          {canCreate && (
            <Button
              onClick={() => {
                void navigate(entry.createHref() ?? "");
              }}
            >
              {t("create")}
            </Button>
          )}
        </Stack>
        <FilterDrawer<Filters>
          value={filters}
          emptyValue={EMPTY_FILTERS}
          activeCount={
            Object.values(filters).filter((value) => value !== null).length
          }
          onApply={(next) => {
            setFilters({ ...next, page: 1 });
          }}
          renderFields={(value, change) => (
            <>
              <Box sx={{ minWidth: 200 }}>
                <OrgTreeSelect
                  scope="visible"
                  label={t("columns.fromBranch")}
                  size="small"
                  fullWidth
                  value={value.fromOrgId === null ? [] : [value.fromOrgId]}
                  onChange={(ids) => {
                    const next = ids[0] ?? null;
                    // 再點一次同一家 = 不篩
                    change({
                      ...value,
                      fromOrgId: next === value.fromOrgId ? null : next,
                    });
                  }}
                />
              </Box>
              <SelectField<string>
                label={t("columns.customer")}
                size="small"
                value={value.customerId ?? ALL}
                options={[
                  { value: ALL, label: t("filters.all") },
                  ...(customers.data?.lotteryWholesaleCustomerFilter ?? []).map(
                    (customer) => ({
                      value: customer.id,
                      label: customer.label,
                    }),
                  ),
                ]}
                onChange={(next) => {
                  change({ ...value, customerId: next === ALL ? null : next });
                }}
                sx={{ minWidth: 200 }}
              />
              <SelectField<
                typeof ALL | (typeof WHOLESALE_PAYMENT_MODES)[number]
              >
                label={t("columns.paymentMode")}
                size="small"
                value={value.paymentMode ?? ALL}
                options={[
                  { value: ALL, label: t("filters.all") },
                  ...WHOLESALE_PAYMENT_MODES.map((mode) => ({
                    value: mode,
                    label: tModes(mode),
                  })),
                ]}
                onChange={(next) => {
                  change({ ...value, paymentMode: next === ALL ? null : next });
                }}
                sx={{ minWidth: 160 }}
              />
              <SelectField<typeof ALL | FormSubmissionStatus>
                label={t("filters.status")}
                size="small"
                value={value.status ?? ALL}
                options={[
                  { value: ALL, label: t("filters.all") },
                  ...REQUISITION_STATUS_ORDER.map((status) => ({
                    value: status,
                    label: tStatus(status),
                  })),
                ]}
                onChange={(next) => {
                  change({ ...value, status: next === ALL ? null : next });
                }}
                sx={{ minWidth: 160 }}
              />
            </>
          )}
        />
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <AccountsList
            aria-label={t("listAria")}
            columns={columns}
            rows={query.data?.lotteryWholesales.items ?? []}
            getRowKey={(row) => row.id}
            isLoading={query.isLoading}
            emptyMessage={t("empty")}
            minWidth={TABLE_MIN_WIDTH}
            card={{
              title: ["serialNo", "customer"],
              tag: "status",
              actions: "delete",
            }}
            onRowClick={(row) => {
              if (access.viewRoute !== null) {
                void navigate(`${access.viewRoute}/${row.id}`);
              }
            }}
          />
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
            {t("total", { total: totalCount })}
          </Typography>
          <Pagination
            count={Math.max(1, Math.ceil(totalCount / WHOLESALE_PAGE_SIZE))}
            page={page}
            onChange={(_event, next) => {
              setFilters((current) => ({ ...current, page: next }));
            }}
          />
        </Stack>
      </Stack>
    </Card>
  );
};
