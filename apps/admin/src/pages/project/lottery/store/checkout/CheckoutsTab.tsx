import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  DEFAULT_TENANT_TIMEZONE,
  addLocalCalendar,
  parseLocalDate,
  startOfLocalDay,
} from "@repo/domain/form";
import { CHECKOUT_TYPES, STORE_KEY } from "@repo/domain/project/lottery";
import {
  type LotteryCheckoutsQuery,
  useLotteryCheckoutsQuery,
  useLotteryStoreBoardQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Pagination } from "@repo/ui/pagination";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { DateFilterPicker } from "@/components/project/DateFilterPicker/DateFilterPicker";
import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";

import { moneyText } from "../store-text";
import { signedMoneyText } from "./checkout-text";

type Row = LotteryCheckoutsQuery["lotteryCheckouts"]["items"][number];

const orgSchema = z.string().default("");
const ALL = "all";
/** 一頁幾筆(api 上限 100)。 */
export const CHECKOUTS_PAGE_SIZE = 20;

/** 列表的「狀態」= 申請的狀態(待審核 / 已退回 / 已撤回 / 已完成)。 */
const STATUSES = ["reviewing", "returned", "withdrawn", "completed"] as const;

/** 網址 `?checkouts=`(REACT-14):期間、收銀點、類型、狀態、頁碼。 */
const filtersSchema = z
  .object({
    from: z.string().default(""),
    to: z.string().default(""),
    cashPointId: z.string().default(ALL),
    type: z.enum([ALL, ...CHECKOUT_TYPES]).default(ALL),
    status: z.enum([ALL, ...STATUSES]).default(ALL),
    page: z.number().int().min(1).default(1),
  })
  .default({
    from: "",
    to: "",
    cashPointId: ALL,
    type: ALL,
    status: ALL,
    page: 1,
  });

type Filters = z.infer<typeof filtersSchema>;

const EMPTY_FILTERS: Filters = {
  from: "",
  to: "",
  cashPointId: ALL,
  type: ALL,
  status: ALL,
  page: 1,
};

const statusTone = (status: string) => {
  if (status === "reviewing") {
    return "warning" as const;
  }
  if (status === "completed") {
    return "success" as const;
  }
  return status === "returned" ? ("error" as const) : ("grey" as const);
};

/** 當地日期(含)→ api 的時點;空 = 不限。 */
const instantOf = (
  text: string,
  timezone: string,
  endOfDay: boolean,
): string | null => {
  const date = parseLocalDate(text === "" ? null : text);
  if (date === null) {
    return null;
  }
  const start = startOfLocalDay(date, timezone);
  return new Date(
    endOfDay ? addLocalCalendar(start, 1, "days", timezone) : start,
  ).toISOString();
};

/**
 * 班次結帳歷史紀錄分頁(規格 6.1、6.10、8.7;Figma ST-27;平板 / 手機照規則改卡片):結帳確認申請的列表,
 * 篩選 期間、收銀點、類型、狀態(「待審核」= 審核中);欄位 單號、收銀點、類型、交班人、應有、實點、差額、狀態;
 * 點一列開結帳確認申請的檢視頁。分店沿用看板的 `?org=`;篩選與頁碼在 `?checkouts=`。
 */
export const CheckoutsTab = () => {
  const t = useTranslations("admin.lotteryStore.checkout");
  const { session } = useSession();
  const me = useMe();
  const navigate = useNavigate();
  const access = useFormModuleAccess(STORE_KEY);
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const isNarrow = useBreakpointDown("lg");
  const [orgParam] = useUrlState("org", orgSchema);
  const orgId = orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam;
  const [filters, setFilters] = useUrlState("checkouts", filtersSchema);
  const board = useLotteryStoreBoardQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const cashPoints = board.data?.lotteryStoreBoard.item.cashPoints ?? [];
  const query = useLotteryCheckoutsQuery(
    session.client,
    {
      input: {
        orgId,
        from: instantOf(filters.from, timezone, false),
        to: instantOf(filters.to, timezone, true),
        cashPointId: filters.cashPointId === ALL ? null : filters.cashPointId,
        type: filters.type === ALL ? null : filters.type,
        status: filters.status === ALL ? null : filters.status,
        offset: (filters.page - 1) * CHECKOUTS_PAGE_SIZE,
        limit: CHECKOUTS_PAGE_SIZE,
      },
    },
    { enabled: orgId !== "" },
  );
  const rows = query.data?.lotteryCheckouts.items ?? [];
  const total = query.data?.lotteryCheckouts.total ?? 0;
  const open = (row: Row) => {
    if (access.viewRoute !== null) {
      void navigate(`${access.viewRoute}/${row.submissionId}`);
    }
  };
  const statusTag = (row: Row) => (
    <Tag
      tone={statusTone(row.submissionStatus)}
      label={
        (STATUSES as readonly string[]).includes(row.submissionStatus)
          ? t(`list.statuses.${row.submissionStatus}`)
          : row.submissionStatus
      }
    />
  );
  const differenceText = (row: Row) => (
    <Typography
      variant="body2"
      component="span"
      color={row.difference === 0 ? "textPrimary" : "error"}
    >
      {signedMoneyText(row.difference)}
    </Typography>
  );
  const columns: TableColumn<Row>[] = [
    {
      key: "serialNo",
      header: t("list.columns.serialNo"),
      render: (row) => row.serialNo ?? "—",
    },
    {
      key: "cashPoint",
      header: t("list.columns.cashPoint"),
      render: (row) => row.cashPoint?.name ?? "—",
    },
    {
      key: "type",
      header: t("list.columns.type"),
      render: (row) => t(`types.${row.type}`),
    },
    {
      key: "submittedBy",
      header: t("list.columns.submittedBy"),
      render: (row) => row.submittedBy?.name ?? "—",
    },
    {
      key: "expected",
      header: t("list.columns.expected"),
      align: "right",
      render: (row) => moneyText(row.expected),
    },
    {
      key: "counted",
      header: t("list.columns.counted"),
      align: "right",
      render: (row) => moneyText(row.counted),
    },
    {
      key: "difference",
      header: t("list.columns.difference"),
      align: "right",
      render: differenceText,
    },
    { key: "status", header: t("list.columns.status"), render: statusTag },
  ];
  const activeCount = [
    filters.from !== "",
    filters.to !== "",
    filters.cashPointId !== ALL,
    filters.type !== ALL,
    filters.status !== ALL,
  ].filter(Boolean).length;

  return (
    // 列表分頁(STYLE-08):平板以上分頁殼釘高,清單那一層吃掉剩下的高度並自己捲(表頭固定);手機寬整頁捲
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <FilterDrawer<Filters>
        value={filters}
        emptyValue={EMPTY_FILTERS}
        activeCount={activeCount}
        onApply={(next) => {
          setFilters({ ...next, page: 1 });
        }}
        renderFields={(value, change) => (
          <Stack
            direction={{ xs: "column", lg: "row" }}
            spacing={1.5}
            sx={{ flexWrap: "wrap" }}
          >
            <DateFilterPicker
              label={t("list.from")}
              size="small"
              value={value.from === "" ? null : value.from}
              onChange={(next) => {
                change({ ...value, from: next ?? "" });
              }}
            />
            <DateFilterPicker
              label={t("list.to")}
              size="small"
              value={value.to === "" ? null : value.to}
              onChange={(next) => {
                change({ ...value, to: next ?? "" });
              }}
            />
            <SelectField
              label={t("list.cashPoint")}
              size="small"
              value={value.cashPointId}
              options={[
                { value: ALL, label: t("list.all") },
                ...cashPoints.map((point) => ({
                  value: point.id,
                  label: point.name,
                })),
              ]}
              onChange={(next: string) => {
                change({ ...value, cashPointId: next });
              }}
              sx={{ minWidth: 140 }}
            />
            <SelectField
              label={t("list.type")}
              size="small"
              value={value.type}
              options={[
                { value: ALL, label: t("list.all") },
                ...CHECKOUT_TYPES.map((type) => ({
                  value: type,
                  label: t(`types.${type}`),
                })),
              ]}
              onChange={(next: Filters["type"]) => {
                change({ ...value, type: next });
              }}
              sx={{ minWidth: 120 }}
            />
            <SelectField
              label={t("list.status")}
              size="small"
              value={value.status}
              options={[
                { value: ALL, label: t("list.all") },
                ...STATUSES.map((status) => ({
                  value: status,
                  label: t(`list.statuses.${status}`),
                })),
              ]}
              onChange={(next: Filters["status"]) => {
                change({ ...value, status: next });
              }}
              sx={{ minWidth: 120 }}
            />
          </Stack>
        )}
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {isNarrow ? (
          // 卡片清單(lg 以下):平板以上分頁殼釘高時由這一層在卡片裡捲;md 以下高度跟著內容,整頁捲
          <Stack spacing={1.5} sx={{ height: "100%", overflow: "auto" }}>
            {rows.length === 0 && !query.isLoading ? (
              <Typography color="textSecondary">{t("list.empty")}</Typography>
            ) : null}
            {rows.map((row) => (
              <Card
                key={row.id}
                variant="outlined"
                role="button"
                tabIndex={0}
                onClick={() => {
                  open(row);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    open(row);
                  }
                }}
                sx={{ flexShrink: 0, px: 2, py: 1.5, cursor: "pointer" }}
              >
                <Stack spacing={0.5}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>
                      {[
                        row.serialNo ?? "—",
                        row.cashPoint?.name ?? t(`types.${row.type}`),
                        row.submittedBy?.name ?? "",
                      ]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    </Typography>
                    {statusTag(row)}
                  </Stack>
                  <Typography variant="body2">
                    {t("list.cardFacts", {
                      expected: moneyText(row.expected),
                      counted: moneyText(row.counted),
                      difference: signedMoneyText(row.difference),
                    })}
                  </Typography>
                </Stack>
              </Card>
            ))}
          </Stack>
        ) : (
          <Table
            minWidth={960}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            isLoading={query.isLoading}
            emptyMessage={t("list.empty")}
            onRowClick={open}
          />
        )}
      </Box>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", justifyContent: "flex-end" }}
      >
        <Typography variant="body2" color="textSecondary">
          {t("list.total", { count: total })}
        </Typography>
        {total > CHECKOUTS_PAGE_SIZE ? (
          <Pagination
            count={Math.ceil(total / CHECKOUTS_PAGE_SIZE)}
            page={filters.page}
            onChange={(_, page) => {
              setFilters({ ...filters, page });
            }}
          />
        ) : null}
      </Stack>
    </Stack>
  );
};
