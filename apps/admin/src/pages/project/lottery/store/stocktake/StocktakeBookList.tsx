import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import {
  displayBookNo,
  isStocktakeStockLine,
} from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../store-text";
import { groupDiffOf } from "./stocktake-count-model";
import {
  type SheetBook,
  type SheetCashPoint,
  type SheetCountGroup,
  type StocktakeState,
  bookKeyOf,
  countGroupKeyOf,
  figuresOf,
  placeNameOf,
} from "./stocktake-model";

export interface StocktakeBookListProps {
  cashPoints: readonly SheetCashPoint[];
  books: readonly SheetBook[];
  /** 張數盤點的組(編號盤點 = 空) */
  countGroups?: readonly SheetCountGroup[];
  state: StocktakeState;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** 有 `store.redeem` 才給(沒有權限看不到 [補登兌獎]) */
  onRedeem: ((cashPoint: SheetCashPoint) => void) | null;
  /** 手機寬度:本清單改成上方的下拉 */
  isNarrow: boolean;
  /** 這一組正在全店重刷(8.5a B5):變灰、標「重刷中」 */
  isGroupBlocked?: (group: SheetCountGroup) => boolean;
  /** 庫存那一區這本的遊戲正在全店重刷 */
  isBookBlocked?: (book: SheetBook) => boolean;
}

/**
 * 盤點頁左欄的本清單(規格 6.8;Figma ST-13):依收銀點分組,每個收銀點旁有 [補登兌獎](立即生效)與
 * 那個收銀點目前的「應有現金」(唯讀);沒有開著的班時 [補登兌獎] 停用並說明。每本顯示已盤 / 未盤與差異。
 * 手機寬度時本清單改成上方的下拉。
 */
export const StocktakeBookList = ({
  cashPoints,
  books,
  countGroups = [],
  state,
  selectedKey,
  onSelect,
  onRedeem,
  isNarrow,
  isGroupBlocked = () => false,
  isBookBlocked = () => false,
}: StocktakeBookListProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const rescanText = useTranslations("admin.lotteryStore.rescan.stocktake");
  const rescanTag = <Tag tone="grey" label={rescanText("tag")} />;
  const statusOf = (book: SheetBook) => {
    const key = bookKeyOf(book);
    if (isBookBlocked(book)) {
      return rescanTag;
    }
    const count = state.counts[key];
    if (key === selectedKey) {
      return <Tag tone="primary" label={t("bookStatus.current")} />;
    }
    if (count === undefined) {
      return <Tag tone="grey" label={t("bookStatus.uncounted")} />;
    }
    const diff = figuresOf(book, count).diffNos.length;
    return diff > 0 ? (
      <Tag tone="warning" label={t("bookStatus.diff", { count: diff })} />
    ) : (
      <Tag tone="success" label={t("bookStatus.counted")} />
    );
  };
  /** 張數盤點一組的狀態:目前這組 / 還沒數 / 已數 / 差 N 張(Figma CS-09a / 09b)。 */
  const groupStatusOf = (group: SheetCountGroup) => {
    const key = countGroupKeyOf(group);
    if (isGroupBlocked(group)) {
      return rescanTag;
    }
    const diff = groupDiffOf(group, state.groups[key]);
    if (key === selectedKey && diff === null) {
      return <Tag tone="primary" label={t("bookStatus.currentGroup")} />;
    }
    if (diff === null) {
      return <Tag tone="grey" label={t("bookStatus.uncounted")} />;
    }
    return diff === 0 ? (
      <Tag tone="success" label={t("bookStatus.counted")} />
    ) : (
      <Tag
        tone="warning"
        label={t("bookStatus.diff", { count: Math.abs(diff) })}
      />
    );
  };
  const selectableRow = (
    key: string,
    title: string,
    subtitle: string,
    status: ReactNode,
    dimmed = false,
  ) => (
    <Box
      key={key}
      role="button"
      tabIndex={0}
      aria-current={key === selectedKey ? "true" : undefined}
      onClick={() => {
        onSelect(key);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onSelect(key);
        }
      }}
      sx={{
        px: 1.5,
        py: 1,
        borderRadius: 1,
        cursor: "pointer",
        bgcolor: key === selectedKey ? "grey.100" : undefined,
        "&:hover": { bgcolor: "grey.50" },
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography variant="caption" color="textSecondary">
            {subtitle}
          </Typography>
        </Stack>
        {status}
      </Stack>
    </Box>
  );
  const groupRow = (group: SheetCountGroup, pointName: string) =>
    selectableRow(
      countGroupKeyOf(group),
      `${group.gameCode} ${group.gameName}`,
      t("count.subtitle", {
        cashPoint: pointName,
        count: group.bookNos.length,
      }),
      groupStatusOf(group),
      isGroupBlocked(group),
    );
  const cashPointHeader = (point: SheetCashPoint) => (
    <Stack spacing={0.5} key={`head-${point.id}`}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="subtitle2" sx={{ color: "primary.dark" }}>
          {point.name}
        </Typography>
        {onRedeem === null ? null : (
          <Button
            size="small"
            variant="outlined"
            disabled={point.shift == null}
            onClick={() => {
              onRedeem(point);
            }}
          >
            {t("cashPoint.redeem")}
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="textSecondary">
        {point.shift == null
          ? t("cashPoint.noShift")
          : `${t("cashPoint.expected", {
              amount: moneyText(point.shift.expectedCash ?? 0),
            })} · ${t("cashPoint.immediate")}`}
      </Typography>
    </Stack>
  );

  const bookRow = (book: SheetBook) => {
    const key = bookKeyOf(book);
    return (
      <Box
        key={key}
        role="button"
        tabIndex={0}
        aria-current={key === selectedKey ? "true" : undefined}
        onClick={() => {
          onSelect(key);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSelect(key);
          }
        }}
        sx={{
          px: 1.5,
          py: 1,
          borderRadius: 1,
          cursor: "pointer",
          bgcolor: key === selectedKey ? "grey.100" : undefined,
          "&:hover": { bgcolor: "grey.50" },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {`${book.gameCode} ${book.gameName}`}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              {t(
                isStocktakeStockLine(book.cashPointId)
                  ? "book.subtitleStock"
                  : "book.subtitle",
                {
                  bookNo: displayBookNo(book.bookNo),
                  count: book.tickets.filter(
                    (ticket) => ticket.status === "unsold",
                  ).length,
                },
              )}
            </Typography>
          </Stack>
          {statusOf(book)}
        </Stack>
      </Box>
    );
  };
  // 拆過、在庫存的張那一區(收銀點 = `STOCKTAKE_STOCK_LINE`)排在收銀點之後
  const stockBooks = books.filter((book) =>
    isStocktakeStockLine(book.cashPointId),
  );

  if (isNarrow) {
    return (
      <Stack spacing={1.5}>
        {cashPoints.map((point) => cashPointHeader(point))}
        <SelectField
          label={t("page.pickBook")}
          size="small"
          fullWidth
          value={selectedKey ?? ""}
          options={[
            ...countGroups.map((group) => ({
              value: countGroupKeyOf(group),
              label: `${placeNameOf(cashPoints, group.cashPointId, t("stock.name"))} · ${group.gameCode} ${group.gameName}`,
            })),
            ...books.map((book) => ({
              value: bookKeyOf(book),
              label: `${placeNameOf(cashPoints, book.cashPointId, t("stock.name"))} · ${book.gameCode} ${book.gameName} · ${displayBookNo(book.bookNo)}`,
            })),
          ]}
          onChange={(next: string) => {
            onSelect(next);
          }}
        />
      </Stack>
    );
  }

  return (
    <Card sx={{ px: 2, py: 2 }}>
      <Stack spacing={2}>
        {cashPoints.map((point) => (
          <Stack key={point.id} spacing={1}>
            {cashPointHeader(point)}
            {countGroups
              .filter((group) => group.cashPointId === point.id)
              .map((group) => groupRow(group, point.name))}
            {books
              .filter((book) => book.cashPointId === point.id)
              .map((book) => bookRow(book))}
          </Stack>
        ))}
        {stockBooks.length > 0 ? (
          <Stack spacing={1}>
            <Stack spacing={0.5}>
              <Typography variant="subtitle2" sx={{ color: "primary.dark" }}>
                {t("stock.title")}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {t("stock.hint")}
              </Typography>
            </Stack>
            {stockBooks.map((book) => bookRow(book))}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
};
