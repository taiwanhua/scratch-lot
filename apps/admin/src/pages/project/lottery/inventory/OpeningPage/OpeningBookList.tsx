import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { displayBookKey, displayBookNo } from "@repo/domain/project/lottery";
import type { LotteryStoreOpeningFieldsFragment } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { useInventoryAccess } from "../useInventoryAccess";

type OpeningBook = LotteryStoreOpeningFieldsFragment["books"][number];

/** 已建檔清單的最小寬度(STYLE-11:六欄不折行)。 */
const OPENING_BOOKS_MIN_WIDTH = 880;

export interface OpeningBookListProps {
  books: readonly OpeningBook[];
  /** 這家店還在建檔(已結束就沒有 [作廢]) */
  canOpen: boolean;
  onVoid: (book: OpeningBook) => void;
}

/**
 * 期初建檔頁下方「這家店已建檔的本」(Figma OP-01b;規格 3.1;api 新的在上):本編號、遊戲、導入前已賣出 / 在手上、
 * 位置、建檔人與時間、[本的詳情]、[作廢](這本還沒有其他動作才能按,不能按時提示請用期初更正)。
 */
export const OpeningBookList = ({
  books,
  canOpen,
  onVoid,
}: OpeningBookListProps) => {
  const t = useTranslations("admin.lotteryInventory.opening");
  const temporal = useTemporalText();
  const navigate = useNavigate();
  const { bookRoute } = useInventoryAccess();
  const columns: TableColumn<OpeningBook>[] = [
    {
      key: "bookNo",
      header: t("list.columns.bookNo"),
      isEmphasized: true,
      render: (row) => displayBookNo(row.bookNo),
    },
    {
      key: "game",
      header: t("list.columns.game"),
      render: (row) => `${row.gameCode} ${row.gameName}`,
    },
    {
      key: "counts",
      header: t("list.columns.counts"),
      align: "right",
      render: (row) =>
        t("list.counts", {
          sold: row.openingSoldCount,
          inHand: row.inHandCount,
        }),
    },
    {
      key: "places",
      header: t("list.columns.places"),
      render: (row) =>
        row.places
          .map((place) =>
            place.cashPoint === null || place.cashPoint === undefined
              ? t("card.placeStock", { count: place.count })
              : t("card.placeCounter", {
                  name: place.cashPoint.name,
                  count: place.count,
                }),
          )
          .join(" · "),
    },
    {
      key: "openedBy",
      header: t("list.columns.openedBy"),
      render: (row) =>
        t("list.openedBy", {
          name: row.openedBy?.name ?? "",
          time: temporal(row.openingAt, "monthDayTime"),
        }),
    },
    {
      key: "actions",
      header: t("list.columns.actions"),
      render: (row) => (
        <Stack direction="row" spacing={0.5}>
          {bookRoute === null ? null : (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                void navigate(`${bookRoute}/${row.bookId}`);
              }}
            >
              {t("list.detail")}
            </Button>
          )}
          {canOpen ? (
            <Tooltip title={row.voidable ? "" : t("list.voidBlocked")}>
              <Button
                variant="text"
                size="small"
                color="error"
                disabled={!row.voidable}
                aria-label={`${t("list.void")} ${displayBookKey(row.gameCode, row.bookNo)}`}
                onClick={() => {
                  onVoid(row);
                }}
              >
                {t("list.void")}
              </Button>
            </Tooltip>
          ) : null}
        </Stack>
      ),
    },
  ];
  return (
    <Card sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" color="textPrimary" sx={{ mb: 1.5 }}>
        {t("list.title")}
      </Typography>
      <Table
        aria-label={t("list.aria")}
        columns={columns}
        rows={books}
        getRowKey={(row) => row.bookId}
        emptyMessage={t("list.empty")}
        minWidth={OPENING_BOOKS_MIN_WIDTH}
      />
    </Card>
  );
};
