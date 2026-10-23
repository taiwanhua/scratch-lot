import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  STOCKTAKE_STATUSES,
  STOCKTAKE_TYPES,
  STORE_KEY,
} from "@repo/domain/project/lottery";
import {
  type LotteryStocktakesQuery,
  useLotteryStocktakesQuery,
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

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";

import { moneyText } from "../store-text";

type Row = LotteryStocktakesQuery["lotteryStocktakes"]["items"][number];

const orgSchema = z.string().default("");
const ALL = "all";
/** 一頁幾筆(api 上限 100)。 */
export const STOCKTAKES_PAGE_SIZE = 20;

/** 網址 `?stocktakes=`(REACT-14):類型、狀態、頁碼。 */
const filtersSchema = z
  .object({
    type: z.enum([ALL, ...STOCKTAKE_TYPES]).default(ALL),
    status: z.enum([ALL, ...STOCKTAKE_STATUSES]).default(ALL),
    page: z.number().int().min(1).default(1),
  })
  .default({ type: ALL, status: ALL, page: 1 });

const statusTone = (status: string) => {
  if (status === "pending") {
    return "warning" as const;
  }
  if (status === "confirmed") {
    return "success" as const;
  }
  return status === "rejected" ? ("error" as const) : ("grey" as const);
};

/**
 * 盤點紀錄分頁(規格 6.1、8.6;Figma ST-29;平板 / 手機照規則改卡片):篩選 類型、狀態;欄位 單號、類型、
 * 盤點時間、補登售出、新增待查、確認遺失、狀態;點一列開那張申請的檢視頁(交班 / 日結的盤點跟著結帳確認申請)。
 * 分店沿用看板的 `?org=`;篩選與頁碼在 `?stocktakes=`。
 */
export const StocktakesTab = () => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const { session } = useSession();
  const me = useMe();
  const temporal = useTemporalText();
  const navigate = useNavigate();
  const access = useFormModuleAccess(STORE_KEY);
  const isNarrow = useBreakpointDown("lg");
  const [orgParam] = useUrlState("org", orgSchema);
  const orgId = orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam;
  const [filters, setFilters] = useUrlState("stocktakes", filtersSchema);
  const query = useLotteryStocktakesQuery(
    session.client,
    {
      input: {
        orgId,
        type: filters.type === ALL ? null : filters.type,
        status: filters.status === ALL ? null : filters.status,
        offset: (filters.page - 1) * STOCKTAKES_PAGE_SIZE,
        limit: STOCKTAKES_PAGE_SIZE,
      },
    },
    { enabled: orgId !== "" },
  );
  const rows = query.data?.lotteryStocktakes.items ?? [];
  const total = query.data?.lotteryStocktakes.total ?? 0;
  const open = (row: Row) => {
    if (access.viewRoute !== null) {
      void navigate(`${access.viewRoute}/${row.submissionId}`);
    }
  };
  const backfillText = (row: Row) =>
    row.summary.backfillCount === 0
      ? "0"
      : t("list.backfillValue", {
          count: row.summary.backfillCount,
          amount: moneyText(row.summary.backfillAmount),
        });
  // 狀態旁標示「N 本未盤」(沒盤完送出的盤點;規格 6.8,10/21 定案)
  const statusTag = (row: Row) => (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
      <Tag tone={statusTone(row.status)} label={t(`statuses.${row.status}`)} />
      {row.summary.uncountedCount > 0 ? (
        <Tag
          tone="warning"
          label={t("list.uncountedTag", { count: row.summary.uncountedCount })}
        />
      ) : null}
    </Stack>
  );
  const columns: TableColumn<Row>[] = [
    {
      key: "serialNo",
      header: t("list.columns.serialNo"),
      render: (row) => row.serialNo ?? "—",
    },
    {
      key: "type",
      header: t("list.columns.type"),
      render: (row) => t(`types.${row.type}`),
    },
    {
      key: "time",
      header: t("list.columns.time"),
      render: (row) => temporal(row.startedAt, "monthDayTime"),
    },
    {
      key: "backfill",
      header: t("list.columns.backfill"),
      align: "right",
      render: backfillText,
    },
    {
      key: "investigate",
      header: t("list.columns.newInvestigate"),
      align: "right",
      render: (row) => row.summary.newInvestigate,
    },
    {
      key: "lost",
      header: t("list.columns.confirmLost"),
      align: "right",
      render: (row) => row.summary.confirmLost,
    },
    { key: "status", header: t("list.columns.status"), render: statusTag },
  ];

  return (
    // 列表分頁(STYLE-08):平板以上分頁殼釘高,清單那一層吃掉剩下的高度並自己捲(表頭固定);手機寬整頁捲
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }}>
        <SelectField
          label={t("list.type")}
          size="small"
          value={filters.type}
          options={[
            { value: ALL, label: t("list.all") },
            ...STOCKTAKE_TYPES.map((type) => ({
              value: type,
              label: t(`types.${type}`),
            })),
          ]}
          onChange={(next: (typeof filters)["type"]) => {
            setFilters({ ...filters, type: next, page: 1 });
          }}
          sx={{ minWidth: 140 }}
        />
        <SelectField
          label={t("list.status")}
          size="small"
          value={filters.status}
          options={[
            { value: ALL, label: t("list.all") },
            ...STOCKTAKE_STATUSES.map((status) => ({
              value: status,
              label: t(`statuses.${status}`),
            })),
          ]}
          onChange={(next: (typeof filters)["status"]) => {
            setFilters({ ...filters, status: next, page: 1 });
          }}
          sx={{ minWidth: 140 }}
        />
      </Stack>
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
                      {[row.serialNo ?? "—", t(`types.${row.type}`)].join(
                        " · ",
                      )}
                    </Typography>
                    {statusTag(row)}
                  </Stack>
                  <Typography variant="body2" color="textSecondary">
                    {temporal(row.startedAt, "monthDayTime")}
                  </Typography>
                  <Typography variant="body2">
                    {t("list.cardFacts", {
                      backfill: backfillText(row),
                      investigate: row.summary.newInvestigate,
                      lost: row.summary.confirmLost,
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
        {total > STOCKTAKES_PAGE_SIZE ? (
          <Pagination
            count={Math.ceil(total / STOCKTAKES_PAGE_SIZE)}
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
