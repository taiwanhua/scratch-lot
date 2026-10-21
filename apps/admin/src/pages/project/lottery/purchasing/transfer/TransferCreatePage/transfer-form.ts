import type { StoredValues } from "@repo/domain/form";
import {
  TRANSFER_FIELD_KEYS as K,
  TRANSFER_MODE,
  type TransferMode,
  displayBookKey,
  parseTicketInput,
  purchaseAmountOf,
  ticketNosText,
  transferLineAmountOf,
} from "@repo/domain/project/lottery";
import type { LotteryTransferOptionsQuery } from "@repo/graphql";

/**
 * 調貨單新增頁的純函式(規格 8.4;Figma PU-09):整本加入 / 選張加入、刷條碼找本、批購金額率逐本改、
 * 金額(整本 = 整本金額;選張 = 面額 × 張數)、調貨金額、組成表單存值。
 */
export type TransferOptions =
  LotteryTransferOptionsQuery["lotteryTransferOptions"];
export type TransferBookOption = TransferOptions["books"][number];

/** 明細的一列(畫面狀態)。 */
export interface TransferDraftLine {
  rowId: string;
  book: TransferBookOption;
  mode: TransferMode;
  /** 選張的張號(3 位、排序);整本 = 空陣列。 */
  ticketNos: string[];
  /** 批購金額率(整數 %;預設這一本的成本率)。 */
  rate: number;
}

/** 一列的張數:整本 = 出貨店裡這本可以調的張數;選張 = 選的張數。 */
export const lineTicketsOf = (line: TransferDraftLine): number =>
  line.mode === TRANSFER_MODE.whole
    ? line.book.availableCount
    : line.ticketNos.length;

export const lineAmountOf = (line: TransferDraftLine): number =>
  transferLineAmountOf(line.mode, line.book, lineTicketsOf(line));

export const linePurchaseAmountOf = (line: TransferDraftLine): number =>
  purchaseAmountOf(lineAmountOf(line), line.rate);

/** 調貨金額 = 批購金額合計。 */
export const transferTotalOf = (lines: readonly TransferDraftLine[]): number =>
  lines.reduce((sum, line) => sum + linePurchaseAmountOf(line), 0);

/** 顯示用本編號(`5164-056527`)。 */
export const bookLabelOf = (book: TransferBookOption): string =>
  displayBookKey(book.gameCode, book.bookNo);

/** 整本的張號區段(顯示用,例 `001-100`)。 */
const wholeRangeOf = (book: TransferBookOption): string =>
  `001-${String(book.availableCount).padStart(3, "0")}`;

export type AddLineResult =
  | { kind: "added"; lines: TransferDraftLine[] }
  /** 這本已經在單上(整本不能再加;選張不能和整本重複) */
  | { kind: "duplicate" }
  /** 沒選任何張 */
  | { kind: "empty" };

/** 整本加入(只有原封不動在出貨店的本)。 */
export const addWhole = (
  lines: readonly TransferDraftLine[],
  book: TransferBookOption,
  newRowId: () => string,
): AddLineResult => {
  if (lines.some((line) => line.book.bookId === book.bookId)) {
    return { kind: "duplicate" };
  }
  return {
    kind: "added",
    lines: [
      ...lines,
      {
        rowId: newRowId(),
        book,
        mode: TRANSFER_MODE.whole,
        ticketNos: [],
        rate: book.rate,
      },
    ],
  };
};

/** 選張加入:同一本已有選張的列就併進去(張號去重),已有整本 → 重複。 */
export const addPartial = (
  lines: readonly TransferDraftLine[],
  book: TransferBookOption,
  ticketNos: readonly string[],
  newRowId: () => string,
): AddLineResult => {
  if (ticketNos.length === 0) {
    return { kind: "empty" };
  }
  const existing = lines.find((line) => line.book.bookId === book.bookId);
  if (existing?.mode === TRANSFER_MODE.whole) {
    return { kind: "duplicate" };
  }
  if (existing !== undefined) {
    const merged = [...new Set([...existing.ticketNos, ...ticketNos])].toSorted(
      (left, right) => left.localeCompare(right),
    );
    return {
      kind: "added",
      lines: lines.map((line) =>
        line.rowId === existing.rowId ? { ...line, ticketNos: merged } : line,
      ),
    };
  }
  return {
    kind: "added",
    lines: [
      ...lines,
      {
        rowId: newRowId(),
        book,
        mode: TRANSFER_MODE.partial,
        ticketNos: [...ticketNos].toSorted((left, right) =>
          left.localeCompare(right),
        ),
        rate: book.rate,
      },
    ],
  };
};

export const removeLine = (
  lines: readonly TransferDraftLine[],
  rowId: string,
): TransferDraftLine[] => lines.filter((line) => line.rowId !== rowId);

export const setLineRate = (
  lines: readonly TransferDraftLine[],
  rowId: string,
  rate: number,
): TransferDraftLine[] =>
  lines.map((line) => (line.rowId === rowId ? { ...line, rate } : line));

/** 刷到的碼 → 出貨店能調的哪一本、哪一張;找不到 → null(背面編號另比遊戲代號)。 */
export const bookOfScan = (
  books: readonly TransferBookOption[],
  raw: string,
): { book: TransferBookOption; ticketNo: string } | null => {
  const parsed = parseTicketInput(raw);
  if (parsed === null) {
    return null;
  }
  const book = books.find(
    (item) =>
      item.bookNo === parsed.bookNo &&
      (parsed.gameCode === undefined || item.gameCode === parsed.gameCode),
  );
  return book === undefined ? null : { book, ticketNo: parsed.ticketNo };
};

/** 單頭的畫面狀態。 */
export interface TransferHeaderState {
  fromBranchId: string;
  toBranchId: string;
  requisitionNo: string | null;
  note: string;
}

/** 表單存值(受管表單 `transfer`):單頭 + 明細(張數、金額照本與方式;批購金額由列內公式算)。 */
export const transferValuesOf = (
  header: TransferHeaderState,
  lines: readonly TransferDraftLine[],
): StoredValues => ({
  [K.fromBranch]: header.fromBranchId === "" ? null : header.fromBranchId,
  [K.toBranch]: header.toBranchId === "" ? null : header.toBranchId,
  [K.requisition]: header.requisitionNo,
  [K.note]: header.note.trim() === "" ? null : header.note.trim(),
  [K.lines]: lines.map((line) => ({
    rowId: line.rowId,
    [K.game]: { id: line.book.gameId, label: line.book.gameName },
    [K.book]: { id: line.book.bookId, label: bookLabelOf(line.book) },
    [K.mode]: line.mode,
    [K.ticketNos]:
      line.mode === TRANSFER_MODE.whole
        ? wholeRangeOf(line.book)
        : ticketNosText(line.ticketNos),
    [K.tickets]: lineTicketsOf(line),
    [K.amount]: lineAmountOf(line),
    [K.rate]: line.rate,
  })),
});
