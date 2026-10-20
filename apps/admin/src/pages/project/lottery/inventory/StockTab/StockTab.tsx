import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  INVENTORY_BOOK_FILTER_STATES,
  displayBookNo,
} from "@repo/domain/project/lottery";
import {
  type LotteryInventoryBookFieldsFragment,
  useLotteryGamesQuery,
  useLotteryInventoryBooksQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { DatePicker } from "@repo/ui/date-picker";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";

import { nextDayText } from "../../accounts/CashLedgerTab/next-day";
import {
  BOOKS_TABLE_MIN_WIDTH,
  holdingsText,
  moneyText,
} from "../inventory-config";
import { useInventoryAccess } from "../useInventoryAccess";

type Book = LotteryInventoryBookFieldsFragment;

/** 庫存分頁的篩選放同一個 key(REACT-14):分店、遊戲、狀態、批購日起迄、本號;空字串 = 預設 / 不篩。 */
const stockSchema = z
  .object({
    org: z.string().default(""),
    game: z.string().default(""),
    state: z.string().default(""),
    from: z.string().default(""),
    to: z.string().default(""),
    bookNo: z.string().default(""),
  })
  .default({ org: "", game: "", state: "", from: "", to: "", bookNo: "" });

/** 「全部」(不篩)的選項值。 */
const ALL = "";

/** 遊戲下拉一次載入的筆數(api 上限)。 */
const GAME_OPTIONS_PAGE_SIZE = 100;

/**
 * 庫存分頁(Figma IN-01 91:17;規格 7.3):分店選擇器(看得到的範圍,預設目前組織,記在網址)→
 * 篩選(遊戲、狀態、批購日、本號)→ 以本為單位的列表(拆開的本顯示「台北 70 / 新竹 30」)。點一列進本的詳情。
 */
export const StockTab = () => {
  const t = useTranslations("admin.lotteryInventory.stock");
  const tStates = useTranslations("admin.lotteryInventory.bookStates");
  const { session } = useSession();
  const me = useMe();
  const navigate = useNavigate();
  const access = useInventoryAccess();
  const temporal = useTemporalText();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [filters, setFilters] = useUrlState("stock", stockSchema);
  const patch = (next: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...next }));
  };
  const orgId =
    filters.org === "" ? (me.data?.me.currentOrg?.id ?? "") : filters.org;

  const games = useLotteryGamesQuery(session.client, {
    input: { page: 1, pageSize: GAME_OPTIONS_PAGE_SIZE },
  });
  const query = useLotteryInventoryBooksQuery(
    session.client,
    {
      input: {
        orgId,
        ...(filters.game === ALL ? {} : { gameId: filters.game }),
        ...(filters.state === ALL ? {} : { state: filters.state }),
        ...(filters.from === ""
          ? {}
          : { purchasedFrom: localDayInstantOf(filters.from, timezone) }),
        ...(filters.to === ""
          ? {}
          : {
              purchasedTo: localDayInstantOf(nextDayText(filters.to), timezone),
            }),
        ...(filters.bookNo.trim() === ""
          ? {}
          : { bookNo: filters.bookNo.trim() }),
      },
    },
    { enabled: orgId !== "" },
  );
  const rows = query.data?.lotteryInventoryBooks.items ?? [];
  const totalCount = query.data?.lotteryInventoryBooks.totalCount ?? 0;

  const columns: TableColumn<Book>[] = [
    {
      key: "bookNo",
      header: t("columns.bookNo"),
      isEmphasized: true,
      render: (row) => displayBookNo(row.bookNo),
    },
    {
      key: "game",
      header: t("columns.game"),
      render: (row) => `${row.gameCode} ${row.gameName}`,
    },
    {
      key: "unitPrice",
      header: t("columns.unitPrice"),
      align: "right",
      render: (row) => moneyText(row.unitPrice),
    },
    {
      key: "holdings",
      header: t("columns.holdings"),
      render: (row) =>
        row.holdings.length === 0 ? row.org.name : holdingsText(row.holdings),
    },
    {
      key: "remaining",
      header: t("columns.remaining"),
      align: "right",
      render: (row) =>
        t("remaining", {
          remaining: row.remainingCount,
          total: row.totalCount,
        }),
    },
    {
      key: "pendingSkip",
      header: t("columns.pendingSkip"),
      render: (row) =>
        row.pendingSkipCount > 0 ? (
          <Tag tone="warning" label={String(row.pendingSkipCount)} />
        ) : (
          t("none")
        ),
    },
    {
      key: "purchasedAt",
      header: t("columns.purchasedAt"),
      render: (row) =>
        row.purchasedAt
          ? temporal(row.purchasedAt, "date").slice(5)
          : t("none"),
    },
    {
      key: "dealer",
      header: t("columns.dealer"),
      render: (row) => row.purchaseDealer?.name ?? t("none"),
    },
  ];

  const gameOptions = [
    { value: ALL, label: t("filters.all") },
    ...(games.data?.lotteryGames.items ?? []).map((game) => ({
      value: game.id,
      label: `${game.gameCode} ${game.name}`,
    })),
  ];
  const stateOptions = [
    { value: ALL, label: t("filters.all") },
    ...INVENTORY_BOOK_FILTER_STATES.map((value) => ({
      value,
      label: tStates(value),
    })),
  ];
  const bookRoute = access.bookRoute;
  const rowClick =
    bookRoute === null
      ? {}
      : {
          onRowClick: (row: Book) => {
            void navigate(`${bookRoute}/${row.id}`);
          },
        };

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            md: "repeat(6, minmax(0, 1fr))",
          },
        }}
      >
        <OrgTreeSelect
          scope="visible"
          label={t("filters.org")}
          value={orgId === "" ? [] : [orgId]}
          size="small"
          fullWidth
          onChange={(ids) => {
            patch({ org: ids.at(0) ?? "" });
          }}
        />
        <SelectField
          label={t("filters.game")}
          value={filters.game}
          size="small"
          displayEmpty
          fullWidth
          options={gameOptions}
          onChange={(value: string) => {
            patch({ game: value });
          }}
        />
        <SelectField
          label={t("filters.state")}
          value={filters.state}
          size="small"
          displayEmpty
          fullWidth
          options={stateOptions}
          onChange={(value: string) => {
            patch({ state: value });
          }}
        />
        <DatePicker
          label={t("filters.purchasedFrom")}
          value={filters.from === "" ? null : filters.from}
          size="small"
          onChange={(value) => {
            patch({ from: value ?? "" });
          }}
        />
        <DatePicker
          label={t("filters.purchasedTo")}
          value={filters.to === "" ? null : filters.to}
          size="small"
          onChange={(value) => {
            patch({ to: value ?? "" });
          }}
        />
        <TextField
          label={t("filters.bookNo")}
          value={filters.bookNo}
          size="small"
          fullWidth
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            patch({ bookNo: event.target.value });
          }}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Table
          aria-label={t("listAria")}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={query.isLoading}
          emptyMessage={orgId === "" ? t("pickOrg") : t("empty")}
          minWidth={BOOKS_TABLE_MIN_WIDTH}
          {...rowClick}
        />
      </Box>
      <Typography variant="body2" sx={{ textAlign: "right" }}>
        {t("total", { count: totalCount })}
      </Typography>
    </Stack>
  );
};
