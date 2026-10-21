import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  DEFAULT_TENANT_TIMEZONE,
  addLocalCalendar,
  localDateOf,
  localDateText,
  parseLocalDate,
  startOfLocalDay,
} from "@repo/domain/form";
import {
  REDEMPTION_STATUSES,
  type RedemptionStatus,
} from "@repo/domain/project/lottery";
import {
  useLotteryRedemptionsQuery,
  useLotteryStoreBoardQuery,
} from "@repo/graphql";
import { Card } from "@repo/ui/card";
import { DatePicker } from "@repo/ui/date-picker";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Pagination } from "@repo/ui/pagination";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";

import { moneyText } from "../store-text";
import { type RedemptionRow, statusToneOf } from "./redemption-shared";
import { useRedemptionFlow } from "./useRedemptionFlow";

const orgSchema = z.string().default("");
const ALL = "all";
/** 一頁幾筆(api 上限 100)。 */
export const REDEMPTIONS_PAGE_SIZE = 20;

type StatusFilter = typeof ALL | RedemptionStatus;

/**
 * 網址 `?redemptions=`(REACT-14):期間(`YYYY-MM-DD`,空 = 預設這個月 1 日到今天)、收銀點、狀態、登記人、
 * 單號(原文;api 以 `redemptionSerialQueryOf` 正規化,`RD-0218` 或 `218` 都可)、頁碼。
 */
const filtersSchema = z
  .object({
    from: z.string().default(""),
    to: z.string().default(""),
    cashPointId: z.string().default(ALL),
    status: z.enum([ALL, ...REDEMPTION_STATUSES]).default(ALL),
    redeemedBy: z.string().default(ALL),
    serialNo: z.string().default(""),
    page: z.number().int().min(1).default(1),
  })
  .default({
    from: "",
    to: "",
    cashPointId: ALL,
    status: ALL,
    redeemedBy: ALL,
    serialNo: "",
    page: 1,
  });

interface Filters {
  cashPointId: string;
  status: StatusFilter;
  redeemedBy: string;
  /** 單號搜尋的原文(空 = 不篩) */
  serialNo: string;
  /** `YYYY-MM-DD`(含) */
  from: string | null;
  to: string | null;
}

/** 預設期間:這個月 1 日到今天(租戶時區)。 */
const defaultPeriodOf = (timezone: string): { from: string; to: string } => {
  const today = localDateOf(Date.now(), timezone);
  return {
    from: localDateText({ ...today, day: 1 }),
    to: localDateText(today),
  };
};

/** 期間(當地日期,含頭尾)→ api 的時點區間 `[from, to + 1 天)`。 */
const rangeOf = (
  filters: Filters,
  timezone: string,
): { from: string | null; to: string | null } => {
  const from = parseLocalDate(filters.from);
  const to = parseLocalDate(filters.to);
  return {
    from:
      from === null
        ? null
        : new Date(startOfLocalDay(from, timezone)).toISOString(),
    to:
      to === null
        ? null
        : new Date(
            addLocalCalendar(
              startOfLocalDay(to, timezone),
              1,
              "days",
              timezone,
            ),
          ).toISOString(),
  };
};

/**
 * 兌獎紀錄分頁(專案規格 6.5;Figma ST-40):篩選 收銀點、狀態、登記人、期間、單號(使用者 10/22 定案;輸入單號時
 * 不限期間,其他條件仍同時成立);欄位 單號、時間、收銀點、班次、刮刮樂、金額、狀態、登記人、進貨單;點一列開兌獎紀錄詳情(可從那裡撤銷)。
 * 平板 / 手機改卡片(Figma ST-40;標題列 `單號 · 刮刮樂 · 金額`)、篩選收進抽屜(期間與單號留在外面)。
 * 分店沿用看板的 `?org=`;篩選與頁碼在 `?redemptions=`(url-state-inventory)。登記人的選項取同一段期間出現過的人。
 */
export const RedemptionsTab = () => {
  const t = useTranslations("admin.lotteryStore.redemption");
  const { session } = useSession();
  const me = useMe();
  const temporal = useTemporalText();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const isNarrow = useBreakpointDown("lg");
  const [orgParam] = useUrlState("org", orgSchema);
  const orgId = orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam;
  const [stored, setStored] = useUrlState("redemptions", filtersSchema);
  const period = defaultPeriodOf(timezone);
  const filters: Filters = {
    cashPointId: stored.cashPointId,
    status: stored.status,
    redeemedBy: stored.redeemedBy,
    serialNo: stored.serialNo,
    from: stored.from === "" ? period.from : stored.from,
    to: stored.to === "" ? period.to : stored.to,
  };
  /** 改篩選回到第 1 頁;期間等於預設時不寫進網址。 */
  const setFilters = (next: Filters) => {
    setStored({
      cashPointId: next.cashPointId,
      status: next.status,
      redeemedBy: next.redeemedBy,
      serialNo: next.serialNo,
      from: next.from === period.from ? "" : (next.from ?? ""),
      to: next.to === period.to ? "" : (next.to ?? ""),
      page: 1,
    });
  };
  const flow = useRedemptionFlow();

  const board = useLotteryStoreBoardQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const cashPoints = board.data?.lotteryStoreBoard.item.cashPoints ?? [];
  const hasSerial = filters.serialNo.trim() !== "";
  const baseInput = {
    orgId,
    // 輸入單號時不限期間(api 端也不看期間)
    ...(hasSerial ? {} : rangeOf(filters, timezone)),
    cashPointId: filters.cashPointId === ALL ? null : filters.cashPointId,
    status: filters.status === ALL ? null : filters.status,
  };
  const query = useLotteryRedemptionsQuery(
    session.client,
    {
      input: {
        ...baseInput,
        redeemedBy: filters.redeemedBy === ALL ? null : filters.redeemedBy,
        serialNo: hasSerial ? filters.serialNo : null,
        offset: (stored.page - 1) * REDEMPTIONS_PAGE_SIZE,
        limit: REDEMPTIONS_PAGE_SIZE,
      },
    },
    { enabled: orgId !== "" },
  );
  // 登記人的選項:同一段期間 / 收銀點 / 狀態裡出現過的人(最近 100 筆)
  const peopleQuery = useLotteryRedemptionsQuery(
    session.client,
    { input: { ...baseInput, limit: 100 } },
    { enabled: orgId !== "" },
  );
  const rows = query.data?.lotteryRedemptions.items ?? [];
  const total = query.data?.lotteryRedemptions.total ?? 0;
  const people = [
    ...new Map(
      (peopleQuery.data?.lotteryRedemptions.items ?? []).map((row) => [
        row.redeemedBy.id,
        row.redeemedBy,
      ]),
    ),
  ]
    .map(([, person]) => person)
    .toSorted((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

  const shiftText = (row: RedemptionRow) =>
    `${row.shift.openedBy.name} ${temporal(row.shift.openedAt, "monthDayTime").split(" ").at(-1) ?? ""}`;
  const statusTag = (row: RedemptionRow) => (
    <Tag tone={statusToneOf(row.status)} label={t(`status.${row.status}`)} />
  );
  const purchaseText = (row: RedemptionRow) => row.purchase?.serialNo ?? "—";
  const serialText = (row: RedemptionRow) => row.serialNo ?? "—";

  const columns: TableColumn<RedemptionRow>[] = [
    { key: "serialNo", header: t("columns.serialNo"), render: serialText },
    {
      key: "time",
      header: t("columns.time"),
      render: (row) => temporal(row.redeemedAt, "monthDayTime"),
    },
    {
      key: "cashPoint",
      header: t("columns.cashPoint"),
      render: (row) => row.cashPoint.name,
    },
    { key: "shift", header: t("columns.shift"), render: shiftText },
    {
      key: "ticket",
      header: t("columns.ticket"),
      render: (row) => row.ticketLabel,
    },
    {
      key: "prize",
      header: t("columns.prize"),
      align: "right",
      render: (row) => moneyText(row.prizeAmount),
    },
    { key: "status", header: t("columns.status"), render: statusTag },
    {
      key: "redeemedBy",
      header: t("columns.redeemedBy"),
      render: (row) => row.redeemedBy.name,
    },
    { key: "purchase", header: t("columns.purchase"), render: purchaseText },
  ];

  const activeCount =
    (filters.cashPointId === ALL ? 0 : 1) +
    (filters.status === ALL ? 0 : 1) +
    (filters.redeemedBy === ALL ? 0 : 1);

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h2">
        {t("tab.title")}
      </Typography>
      <FilterDrawer
        value={filters}
        emptyValue={{
          cashPointId: ALL,
          status: ALL,
          redeemedBy: ALL,
          serialNo: filters.serialNo,
          from: filters.from,
          to: filters.to,
        }}
        activeCount={activeCount}
        onApply={setFilters}
        renderFields={(value, change) => (
          <>
            <SelectField
              label={t("tab.cashPoint")}
              size="small"
              value={value.cashPointId}
              options={[
                { value: ALL, label: t("tab.all") },
                ...cashPoints.map((point) => ({
                  value: point.id,
                  label: point.name,
                })),
              ]}
              onChange={(next) => {
                change({ ...value, cashPointId: next });
              }}
              sx={{ minWidth: 140 }}
            />
            <SelectField
              label={t("tab.status")}
              size="small"
              value={value.status}
              options={[
                { value: ALL, label: t("tab.all") },
                ...REDEMPTION_STATUSES.map((status) => ({
                  value: status,
                  label: t(`status.${status}`),
                })),
              ]}
              onChange={(next) => {
                change({ ...value, status: next });
              }}
              sx={{ minWidth: 140 }}
            />
            <SelectField
              label={t("tab.redeemedBy")}
              size="small"
              value={value.redeemedBy}
              options={[
                { value: ALL, label: t("tab.all") },
                ...people.map((person) => ({
                  value: person.id,
                  label: person.name,
                })),
              ]}
              onChange={(next) => {
                change({ ...value, redeemedBy: next });
              }}
              sx={{ minWidth: 140 }}
            />
          </>
        )}
        search={
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <DatePicker
              label={t("tab.from")}
              value={filters.from}
              onChange={(next) => {
                setFilters({ ...filters, from: next });
              }}
            />
            <DatePicker
              label={t("tab.to")}
              value={filters.to}
              onChange={(next) => {
                setFilters({ ...filters, to: next });
              }}
            />
            <TextField
              label={t("tab.serialNo")}
              placeholder={t("tab.serialNoHint")}
              helperText={t("tab.serialNoScope")}
              value={filters.serialNo}
              size="small"
              sx={{ width: { xs: "100%", sm: 180 } }}
              onChange={(event) => {
                setFilters({ ...filters, serialNo: event.target.value });
              }}
            />
          </Stack>
        }
      />
      {isNarrow ? (
        <Stack spacing={1.5}>
          {rows.length === 0 && !query.isLoading ? (
            <Typography color="text.secondary">{t("tab.empty")}</Typography>
          ) : null}
          {rows.map((row) => (
            <Card
              key={row.id}
              variant="outlined"
              role="button"
              tabIndex={0}
              onClick={() => {
                flow.openDetail(row.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  flow.openDetail(row.id);
                }
              }}
              sx={{ px: 2, py: 1.5, cursor: "pointer" }}
            >
              <Stack
                direction="row"
                sx={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <Typography color="text.primary">
                  {`${serialText(row)} · ${row.ticketLabel} · ${t("money", { amount: moneyText(row.prizeAmount) })}`}
                </Typography>
                {statusTag(row)}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t("tab.cardMeta", {
                  cashPoint: row.cashPoint.name,
                  shift: shiftText(row),
                  time: temporal(row.redeemedAt, "monthDayTime"),
                })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("tab.cardBy", {
                  name: row.redeemedBy.name,
                  purchase: purchaseText(row),
                })}
              </Typography>
            </Card>
          ))}
        </Stack>
      ) : (
        <Table
          aria-label={t("tab.title")}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={query.isLoading}
          emptyMessage={t("tab.empty")}
          onRowClick={(row) => {
            flow.openDetail(row.id);
          }}
        />
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t("tab.summary", { count: total })}
        </Typography>
        <Pagination
          count={Math.max(1, Math.ceil(total / REDEMPTIONS_PAGE_SIZE))}
          page={stored.page}
          onChange={(_event, next) => {
            setStored((current) => ({ ...current, page: next }));
          }}
        />
      </Stack>
      {flow.element}
    </Stack>
  );
};
