import { useTranslations } from "use-intl";

import {
  TRANSFER_MODE,
  formatTicketRanges,
} from "@repo/domain/project/lottery";

import type {
  BookListGroup,
  BookListLabels,
  BookRowStatus,
} from "@/components/project/lottery/BookGroupList/BookGroupList";
import { groupBooksByGame } from "@/components/project/lottery/BookGroupList/book-groups";
import { useBookProgressLabel } from "@/components/project/lottery/BookGroupList/useBookProgressLabel";

import { formatMoney } from "../transfer-keys";
import {
  type TransferDraftLine,
  lineAmountOf,
  linePurchaseAmountOf,
  lineTicketsOf,
} from "./transfer-form";

const displayBookNo = (bookNo: string): string =>
  bookNo.startsWith("0") ? bookNo.slice(1) : bookNo;

/**
 * 調貨明細 → 依遊戲分組的本清單(`BookGroupList`)的組與詞:每列一本(或一本的選張;方式寫在本號下面)、
 * 張號區段、張數、金額、批購金額率、批購金額;編輯頁鎖住的列帶狀態,組標題的進度照 `BookGroupList` 的規則。
 */
export const useTransferLineList = (
  lines: readonly TransferDraftLine[],
  lockedRows: ReadonlyMap<string, BookRowStatus>,
): { groups: BookListGroup[]; labels: BookListLabels } => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const tReceive = useTranslations("admin.lotteryPurchasing.receive");
  const progress = useBookProgressLabel();
  const modeText = (line: TransferDraftLine) =>
    line.mode === TRANSFER_MODE.whole ? t("modes.whole") : t("modes.partial");
  const ticketsText = (line: TransferDraftLine) =>
    line.mode === TRANSFER_MODE.whole
      ? `#001–${String(lineTicketsOf(line)).padStart(3, "0")}`
      : formatTicketRanges(line.ticketNos);
  const groups = groupBooksByGame(
    lines,
    (line) => ({
      key: line.book.gameId,
      title: `${line.book.gameCode} ${line.book.gameName}`,
    }),
    (line) => ({
      rowId: line.rowId,
      bookNo: displayBookNo(line.book.bookNo),
      detail: modeText(line),
      ticketText: ticketsText(line),
      tickets: lineTicketsOf(line),
      bookPrice: lineAmountOf(line),
      rate: line.rate,
      amount: linePurchaseAmountOf(line),
      isLocked: lockedRows.has(line.rowId),
      // 在途的列:不能改,但可以移除(路上遺失 → 送出後變待查,規格 8.4)
      isRemovable: lockedRows.get(line.rowId) === "inTransit",
      status: lockedRows.get(line.rowId) ?? null,
    }),
  );
  const labels: BookListLabels = {
    columns: {
      bookNo: t("columns.book"),
      ticket: t("columns.ticketNos"),
      tickets: t("columns.tickets"),
      bookPrice: t("columns.amount"),
      rate: t("columns.rate"),
      amount: t("columns.purchaseAmount"),
      status: tReceive("columns.status"),
    },
    status: {
      received: tReceive("received"),
      notReceived: tReceive("notReceived"),
      inTransit: tReceive("inTransit"),
    },
    remove: t("remove"),
    rateOf: (row) => t("rateOf", { book: row.bookNo }),
    cardFacts: (row) =>
      t("cardFacts", {
        tickets: row.ticketText,
        count: row.tickets,
        amount: formatMoney(row.bookPrice),
        purchase: formatMoney(row.amount),
      }),
    empty: t("noLines"),
    progress,
    tableAria: (group) => t("linesAria", { game: group.title }),
  };

  return { groups, labels };
};
