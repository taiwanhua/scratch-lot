import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { STANDARD_UNIT_PRICES } from "@repo/domain/project/lottery-master-data";
import {
  type LotteryGameFieldsFragment,
  useLotteryGamesQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Pagination } from "@repo/ui/pagination";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import { GameStatusTag } from "../GameStatusTag/GameStatusTag";
import {
  GAMES_TABLE_MIN_WIDTH,
  MASTER_DATA_PAGE_SIZE,
} from "../master-data-config";
import { GameCards } from "./GameCards";
import { GAMES_LIST_KEY, gamesListSchema } from "./games-list";

export interface GamesTabProps {
  /** 詳情頁的路由;沒綁詳情頁 → 列不能點 */
  viewRoute: string | null;
}

const ALL = "all";

/** 金額顯示千分位(與 Figma 一致)。 */
const formatAmount = (value: number) => value.toLocaleString("en-US");

/**
 * 遊戲分頁(Figma MD-01 97:17):篩選列(狀態、面額、關鍵字)+ 表格;手機改卡片(RW-01)。
 * 點一列進詳情頁。篩選放網址 `?games=`。
 */
export const GamesTab = ({ viewRoute }: GamesTabProps) => {
  const t = useTranslations("admin.lotteryMasterData.games");
  const tStatus = useTranslations("admin.lotteryMasterData.status");
  const { session } = useSession();
  const navigate = useNavigate();
  const isMobile = useBreakpointDown("sm");
  const temporal = useTemporalText();
  const [filters, setFilters] = useUrlState(GAMES_LIST_KEY, gamesListSchema);

  const query = useLotteryGamesQuery(session.client, {
    input: {
      page: filters.page,
      pageSize: MASTER_DATA_PAGE_SIZE,
      status: filters.status === "" ? null : filters.status,
      unitPrice: filters.unitPrice,
      keyword: filters.keyword.trim() === "" ? null : filters.keyword.trim(),
    },
  });
  const rows = query.data?.lotteryGames.items ?? [];
  const totalCount = query.data?.lotteryGames.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / MASTER_DATA_PAGE_SIZE));

  let open: ((row: LotteryGameFieldsFragment) => void) | undefined;
  if (viewRoute !== null) {
    open = (row) => {
      void navigate(`${viewRoute}/${row.id}`);
    };
  }

  const rowClick = open === undefined ? {} : { onRowClick: open };

  const columns: TableColumn<LotteryGameFieldsFragment>[] = [
    {
      key: "gameCode",
      header: t("columns.gameCode"),
      width: 80,
      render: (row) => row.gameCode,
    },
    {
      key: "name",
      header: t("columns.name"),
      isEmphasized: true,
      render: (row) => row.name,
    },
    {
      key: "color",
      header: t("columns.color"),
      width: 80,
      render: (row) =>
        isTagPaletteKey(row.color) ? (
          <TagPaletteChip paletteKey={row.color} />
        ) : null,
    },
    {
      key: "unitPrice",
      header: t("columns.unitPrice"),
      align: "right",
      render: (row) => formatAmount(row.unitPrice),
    },
    {
      key: "ticketsPerBook",
      header: t("columns.ticketsPerBook"),
      align: "right",
      render: (row) => formatAmount(row.ticketsPerBook),
    },
    {
      key: "bookPrice",
      header: t("columns.bookPrice"),
      align: "right",
      render: (row) => formatAmount(row.bookPrice),
    },
    {
      key: "defaultRate",
      header: t("columns.defaultRate"),
      align: "right",
      render: (row) => t("rate", { rate: row.defaultRate }),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (row) => <GameStatusTag status={row.status} />,
    },
    {
      key: "launchedAt",
      header: t("columns.launchedAt"),
      render: (row) => (row.launchedAt ? temporal(row.launchedAt, "date") : ""),
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap" }}>
        <SelectField
          label={t("filters.status")}
          size="small"
          value={filters.status === "" ? ALL : filters.status}
          options={[
            { value: ALL, label: t("filters.all") },
            { value: "on_sale", label: tStatus("on_sale") },
            { value: "discontinued", label: tStatus("discontinued") },
          ]}
          onChange={(value) => {
            setFilters((current) => ({
              ...current,
              status: value === ALL ? "" : value,
              page: 1,
            }));
          }}
          sx={{ minWidth: 140 }}
        />
        <SelectField
          label={t("filters.unitPrice")}
          size="small"
          value={filters.unitPrice === null ? ALL : String(filters.unitPrice)}
          options={[
            { value: ALL, label: t("filters.all") },
            ...STANDARD_UNIT_PRICES.map((price) => ({
              value: String(price),
              label: formatAmount(price),
            })),
          ]}
          onChange={(value) => {
            setFilters((current) => ({
              ...current,
              unitPrice: value === ALL ? null : Number(value),
              page: 1,
            }));
          }}
          sx={{ minWidth: 140 }}
        />
        <TextField
          label={t("filters.keyword")}
          size="small"
          value={filters.keyword}
          onChange={(event) => {
            setFilters((current) => ({
              ...current,
              keyword: event.target.value,
              page: 1,
            }));
          }}
          sx={{ minWidth: 220 }}
        />
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {isMobile ? (
          <GameCards rows={rows} isLoading={query.isLoading} onOpen={open} />
        ) : (
          <Table
            aria-label={t("listAria")}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            isLoading={query.isLoading}
            emptyMessage={t("empty")}
            minWidth={GAMES_TABLE_MIN_WIDTH}
            {...rowClick}
          />
        )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t("total", { total: totalCount })}
        </Typography>
        <Pagination
          count={pageCount}
          page={filters.page}
          onChange={(_event, page) => {
            setFilters((current) => ({ ...current, page }));
          }}
        />
      </Stack>
    </Stack>
  );
};
