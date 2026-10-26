import { useTranslations } from "use-intl";

import {
  type LotteryStockOverviewQuery,
  useLotteryStockOverviewQuery,
} from "@repo/graphql";
import { Table, type TableColumn } from "@repo/ui/table";

import { useSession } from "@/hooks/base/useSession";

type Row = LotteryStockOverviewQuery["lotteryStockOverview"]["items"][number];

export interface StockOverviewTableProps {
  /** 遊戲詳情給 `gameId`(每家分店一列);乙類詳情給 `orgId`(每個遊戲一列) */
  input: { orgId?: string; gameId?: string };
  /** 第一欄是分店還是遊戲 */
  rowsBy: "stores" | "games";
}

const countText = (value: number) => value.toLocaleString("en-US");

/**
 * 庫存概況(Figma MD-03 遊戲詳情「庫存概況」、DE-05 乙類詳情「在店庫存」;規格 5.1、5.2):
 * 分店 × 遊戲的未拆(本)、檯面(張)、已售(張)。讀庫存管理的資料(要綁庫存管理)。
 */
export const StockOverviewTable = ({
  input,
  rowsBy,
}: StockOverviewTableProps) => {
  const t = useTranslations("admin.lotteryInventory.stockOverview");
  const { session } = useSession();
  const query = useLotteryStockOverviewQuery(session.client, { input });
  const rows = query.data?.lotteryStockOverview.items ?? [];
  const columns: TableColumn<Row>[] = [
    rowsBy === "stores"
      ? {
          key: "org",
          header: t("store"),
          isEmphasized: true,
          render: (row) => row.org.name,
        }
      : {
          key: "game",
          header: t("game"),
          isEmphasized: true,
          render: (row) => `${row.game.gameCode} ${row.game.name}`,
        },
    {
      key: "unopened",
      header: t("unopened"),
      align: "right",
      render: (row) => countText(row.unopenedBooks),
    },
    {
      key: "openedStock",
      header: t("openedStock"),
      align: "right",
      render: (row) => countText(row.openedStockTickets),
    },
    {
      key: "counter",
      header: t("counter"),
      align: "right",
      render: (row) => countText(row.counterTickets),
    },
    {
      key: "sold",
      header: t("sold"),
      align: "right",
      render: (row) => countText(row.soldTickets),
    },
  ];
  return (
    <Table
      aria-label={t("aria")}
      columns={columns}
      rows={rows}
      getRowKey={(row) => `${row.org.id}:${row.game.id}`}
      isLoading={query.isLoading}
      emptyMessage={t("empty")}
      minWidth={480}
    />
  );
};
