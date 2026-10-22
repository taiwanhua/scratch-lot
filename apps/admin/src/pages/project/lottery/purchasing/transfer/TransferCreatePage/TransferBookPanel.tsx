import { useMemo } from "react";
import { useTranslations } from "use-intl";

import { useLotteryTransferBookTicketsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  TicketGrid,
  type TicketGridCell,
} from "@/components/project/lottery/TicketGrid/TicketGrid";
import type { TicketCellState } from "@/components/project/lottery/TicketGrid/ticket-cell-styles";
import { useSession } from "@/hooks/base/useSession";

import { type TransferBookOption, bookLabelOf } from "./transfer-form";

const NONE = "none";

/** 選張能選的狀態(未售)。 */
const SELECTABLE: readonly TicketCellState[] = ["unsold"];

/** 圖例:未售 / 已售(不能選)/ 已在明細 / 已選。 */
const LEGEND: readonly TicketCellState[] = [
  "unsold",
  "sold",
  "assigned",
  "selected",
];

/** api 的格子狀態 → 格子變體:可以調 = 未售;已售、被鎖定、不在出貨店 = 不能選;跳號。 */
const cellStateOf = (state: string): Exclude<TicketCellState, "selected"> => {
  if (state === "available") {
    return "unsold";
  }
  return state === "skipped" ? "skipped" : "sold";
};

/** 拆過的本:張數格子選張 + [加入選取]。 */
const PartialPicker = ({
  isLoading,
  cells,
  selected,
  onSelectedChange,
  onAdd,
}: {
  isLoading: boolean;
  cells: readonly TicketGridCell[];
  selected: readonly string[];
  onSelectedChange: (selected: string[]) => void;
  onAdd: (ticketNos: string[]) => void;
}) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  if (isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  return (
    <>
      <TicketGrid
        cells={cells}
        selectableStates={SELECTABLE}
        selected={selected}
        onSelectedChange={onSelectedChange}
        legendItems={LEGEND}
        labels={{ sold: t("cellUnavailable"), assigned: t("cellInLines") }}
      />
      <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
        <Button
          variant="outlined"
          disabled={selected.length === 0}
          onClick={() => {
            onAdd([...selected]);
          }}
        >
          {t("addPartial", { count: selected.length })}
        </Button>
      </Stack>
    </>
  );
};

export interface TransferBookPanelProps {
  fromOrgId: string;
  books: readonly TransferBookOption[];
  book: TransferBookOption | null;
  onBookChange: (bookId: string | null) => void;
  /** 已選的張號(受控;刷條碼也會加進來) */
  selected: readonly string[];
  onSelectedChange: (selected: string[]) => void;
  /** 這本已在明細的張號(格子標「已在明細」) */
  inLines: readonly string[];
  /** 有 `purchasing.transfer.partial-tickets` 才能選張 */
  canPartial: boolean;
  onAddWhole: (book: TransferBookOption) => void;
  onAddPartial: (book: TransferBookOption, ticketNos: string[]) => void;
}

/**
 * 調貨單新增頁右側的選本與張數格子(規格 7.5、8.4;Figma PU-09):選出貨店能調的一本 ——
 * 原封不動的本 [整本加入];拆過的本以張數格子選張(連號快選、Shift 連選)後 [加入選取],
 * 要 `partial-tickets`,沒有時不出現格子(L784)。
 */
export const TransferBookPanel = ({
  fromOrgId,
  books,
  book,
  onBookChange,
  selected,
  onSelectedChange,
  inLines,
  canPartial,
  onAddWhole,
  onAddPartial,
}: TransferBookPanelProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const { session } = useSession();
  const showGrid = book !== null && !book.isWhole && canPartial;
  const tickets = useLotteryTransferBookTicketsQuery(
    session.client,
    { fromOrgId, bookId: book?.bookId ?? "" },
    { enabled: showGrid },
  );
  const cells = useMemo((): TicketGridCell[] => {
    const assigned = new Set(inLines);
    return (tickets.data?.lotteryTransferBookTickets ?? []).map((cell) => ({
      ticketNo: cell.ticketNo,
      state: assigned.has(cell.ticketNo) ? "assigned" : cellStateOf(cell.state),
    }));
  }, [tickets.data, inLines]);

  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={1.5}>
        <SelectField<string>
          label={t("pickBook")}
          size="small"
          value={book?.bookId ?? NONE}
          disabled={fromOrgId === ""}
          options={[
            { value: NONE, label: t("pickBookNone") },
            ...books.map((item) => ({
              value: item.bookId,
              label: t("bookOption", {
                game: `${item.gameCode} ${item.gameName}`,
                book: bookLabelOf(item),
                kind: item.isWhole ? t("modes.whole") : t("opened"),
                count: item.availableCount,
              }),
            })),
          ]}
          onChange={(next) => {
            onBookChange(next === NONE ? null : next);
          }}
          fullWidth
        />
        {book === null ? (
          <Typography variant="body2" color="textSecondary">
            {fromOrgId === "" ? t("pickFromBranch") : t("pickBookHint")}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "baseline", flexWrap: "wrap" }}
            >
              <Typography variant="subtitle1" component="h2">
                {t("bookTitle", {
                  game: `${book.gameCode} ${book.gameName}`,
                  bookNo: book.bookNo.startsWith("0")
                    ? book.bookNo.slice(1)
                    : book.bookNo,
                })}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {t("bookFacts", { count: book.availableCount })}
              </Typography>
            </Stack>
            {book.isWhole ? (
              <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                <Button
                  variant="outlined"
                  onClick={() => {
                    onAddWhole(book);
                  }}
                >
                  {t("addWhole")}
                </Button>
              </Stack>
            ) : null}
            {!book.isWhole && !canPartial ? (
              <Alert severity="info">{t("partialForbidden")}</Alert>
            ) : null}
            {showGrid ? (
              <PartialPicker
                isLoading={tickets.isLoading}
                cells={cells}
                selected={selected}
                onSelectedChange={onSelectedChange}
                onAdd={(ticketNos) => {
                  onAddPartial(book, ticketNos);
                }}
              />
            ) : null}
          </Stack>
        )}
      </Stack>
    </Card>
  );
};
