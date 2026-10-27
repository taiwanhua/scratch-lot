import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { formatCount } from "../purchasing-keys";
import {
  type BookCounts,
  type Candidate,
  excessOf,
  salesText,
} from "./requisition-form";

export interface CandidateListProps {
  rows: readonly Candidate[];
  counts: BookCounts;
  isLoading: boolean;
  onChangeBooks: (gameId: string, raw: string) => void;
}

/** 表格最小寬度(STYLE-11:七欄不折行)。 */
const TABLE_MIN_WIDTH = 900;

/** 遊戲欄:【新】+ 代號 名稱 · 面額。 */
export const GameLabel = ({ row }: { row: Candidate }) => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      {row.isNew && <Tag tone="warning" label={t("newGame")} />}
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {t("gameLabel", {
          code: row.gameCode,
          name: row.name,
          price: formatCount(row.unitPrice),
        })}
      </Typography>
    </Stack>
  );
};

/** 「叫幾本」的輸入格。 */
export const BooksInput = ({
  row,
  counts,
  onChangeBooks,
}: Pick<CandidateListProps, "counts" | "onChangeBooks"> & {
  row: Candidate;
}) => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  return (
    <TextField
      label={t("columns.books")}
      size="small"
      type="number"
      value={String(counts[row.gameId] ?? 0)}
      slotProps={{ htmlInput: { min: 0, max: 999, step: 1 } }}
      onChange={(event) => {
        onChangeBooks(row.gameId, event.target.value);
      }}
      sx={{ width: 96 }}
    />
  );
};

/** 超過預計要給本數的提醒(只提醒,可送出)。 */
export const ExcessTag = ({
  row,
  counts,
}: Pick<CandidateListProps, "counts"> & { row: Candidate }) => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  const excess = excessOf(row, counts);
  return excess > 0 ? (
    <Tag tone="warning" label={t("overAllocation", { excess })} />
  ) : null;
};

/** 電腦版的遊戲表格(Figma PU-02 電腦 69:15)。 */
export const CandidateTable = ({
  rows,
  counts,
  isLoading,
  onChangeBooks,
}: CandidateListProps) => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  const columns: TableColumn<Candidate>[] = [
    {
      key: "game",
      header: t("columns.game"),
      width: 300,
      render: (row) => <GameLabel row={row} />,
    },
    {
      key: "stock",
      header: t("columns.stock"),
      width: 120,
      render: (row) => formatCount(row.stockTickets),
    },
    {
      key: "inTransit",
      header: t("columns.inTransit"),
      width: 90,
      render: (row) => formatCount(row.inTransitBooks),
    },
    {
      key: "sold7",
      header: t("columns.sold7"),
      width: 90,
      render: (row) => salesText(row.sold7),
    },
    {
      key: "sold30",
      header: t("columns.sold30"),
      width: 90,
      render: (row) => salesText(row.sold30),
    },
    {
      key: "books",
      header: t("columns.books"),
      width: 120,
      render: (row) => (
        <BooksInput row={row} counts={counts} onChangeBooks={onChangeBooks} />
      ),
    },
    {
      key: "excess",
      header: "",
      render: (row) => <ExcessTag row={row} counts={counts} />,
    },
  ];
  return (
    <Table
      aria-label={t("listAria")}
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.gameId}
      isLoading={isLoading}
      emptyMessage={t("empty")}
      minWidth={TABLE_MIN_WIDTH}
    />
  );
};
