import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryAllocationCellFieldsFragment,
  useLotteryAllocationsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";

import { AllocationEditDialog } from "./AllocationEditDialog";
import {
  type AllocationTextLabels,
  cellText,
  isOverPlanned,
} from "./allocation-text";

interface Ref {
  id: string;
  name: string;
}

interface Game {
  id: string;
  gameCode: string;
  name: string;
}

export interface AllocationsTableProps {
  /** 篩選:遊戲詳情給 `gameId`、乙類詳情給 `orgId`(對應分店);庫存管理不給 */
  input: { orgId?: string; gameId?: string };
  /**
   * 列是什麼:`stores` = 每家分店一列、遊戲是欄(庫存管理、遊戲詳情);
   * `games` = 每個遊戲一列、分店是欄(乙類詳情)
   */
  rowsBy?: "stores" | "games";
}

interface Row {
  key: string;
  label: string;
  /** 這一列的每一格(依欄的順序) */
  pairs: { store: Ref; game: Game }[];
}

/**
 * 預計要給本數(Figma IN-06;規格 7.6):每格「已給 / 預計」,已給超過預計用警告色(只警告)。
 * 有 `inventory.edit-allocations`(api 的 `canEdit`)時點格子修改;沒有時唯讀。
 * 庫存管理、遊戲詳情、乙類詳情三處共用(同一個 api、同一個權限)。手機改成每列一張卡片。
 */
export const AllocationsTable = ({
  input,
  rowsBy = "stores",
}: AllocationsTableProps) => {
  const t = useTranslations("admin.lotteryInventory.allocations");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const [editing, setEditing] = useState<{ store: Ref; game: Game } | null>(
    null,
  );
  const query = useLotteryAllocationsQuery(session.client, { input });
  const data = query.data?.lotteryAllocations;
  const stores = data?.stores ?? [];
  const games = data?.games ?? [];
  const canEdit = data?.canEdit ?? false;
  const cellOf = new Map<string, LotteryAllocationCellFieldsFragment>(
    (data?.cells ?? []).map((cell) => [`${cell.orgId}:${cell.gameId}`, cell]),
  );
  const labels: AllocationTextLabels = {
    extraTickets: (count) => t("extraTickets", { count }),
    none: t("none"),
  };
  const gameLabel = (game: Game) => `${game.gameCode} ${game.name}`;

  const rows: Row[] =
    rowsBy === "stores"
      ? stores.map((store) => ({
          key: store.id,
          label: store.name,
          pairs: games.map((game) => ({ store, game })),
        }))
      : games.map((game) => ({
          key: game.id,
          label: gameLabel(game),
          pairs: stores.map((store) => ({ store, game })),
        }));
  const headers =
    rowsBy === "stores"
      ? games.map((game) => ({ key: game.id, label: gameLabel(game) }))
      : stores.map((store) => ({ key: store.id, label: store.name }));

  const renderCell = ({ store, game }: { store: Ref; game: Game }) => {
    const cell = cellOf.get(`${store.id}:${game.id}`);
    const text = (
      <Typography
        variant="body2"
        sx={{
          whiteSpace: "nowrap",
          color: isOverPlanned(cell) ? "warning.main" : "text.primary",
        }}
      >
        {cellText(cell, labels)}
      </Typography>
    );
    if (!canEdit) {
      return text;
    }
    return (
      <Button
        variant="text"
        size="small"
        aria-label={t("editAria", {
          store: store.name,
          game: gameLabel(game),
        })}
        onClick={() => {
          setEditing({ store, game });
        }}
        sx={{ minWidth: 0, px: 0.5 }}
      >
        {text}
      </Button>
    );
  };

  const caption = (
    <Typography variant="caption" color="textSecondary">
      {canEdit ? t("captionEditable") : t("caption")}
    </Typography>
  );
  const dialog =
    editing === null ? null : (
      <AllocationEditDialog
        store={editing.store}
        game={editing.game}
        cell={cellOf.get(`${editing.store.id}:${editing.game.id}`)}
        labels={labels}
        onClose={() => {
          setEditing(null);
        }}
      />
    );

  if (isMobile) {
    return (
      <Stack spacing={1.5}>
        {rows.map((row) => (
          <Card key={row.key} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="textPrimary">
              {t("cardTitle", { name: row.label })}
            </Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {row.pairs.map((pair, index) => (
                <Stack
                  key={headers[index]?.key ?? String(index)}
                  direction="row"
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body2">
                    {headers[index]?.label}
                  </Typography>
                  {renderCell(pair)}
                </Stack>
              ))}
            </Stack>
          </Card>
        ))}
        {rows.length === 0 && !query.isLoading ? (
          <Typography variant="body2">{t("empty")}</Typography>
        ) : null}
        {caption}
        {dialog}
      </Stack>
    );
  }

  const columns: TableColumn<Row>[] = [
    {
      key: "label",
      header: rowsBy === "stores" ? t("store") : t("game"),
      isEmphasized: true,
      render: (row) => row.label,
    },
    ...headers.map((header, index) => ({
      key: header.key,
      header: header.label,
      render: (row: Row) => {
        const pair = row.pairs.at(index);
        return pair === undefined ? null : renderCell(pair);
      },
    })),
  ];
  return (
    <Stack spacing={1.5}>
      {caption}
      <Box>
        <Table
          aria-label={t("aria")}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.key}
          isLoading={query.isLoading}
          emptyMessage={t("empty")}
          minWidth={180 + headers.length * 140}
        />
      </Box>
      {dialog}
    </Stack>
  );
};
