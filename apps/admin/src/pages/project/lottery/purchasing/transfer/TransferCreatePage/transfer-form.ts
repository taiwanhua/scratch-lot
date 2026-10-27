import type { StoredValues } from "@repo/domain/form";
import {
  TRANSFER_FIELD_KEYS as K,
  TRANSFER_MODE,
  type TransferMode,
  displayBookKey,
  matchBookScan,
  parseTicketInput,
  purchaseAmountOf,
  ticketNosText,
  transferHeaderOf,
  transferLineAmountOf,
  transferLinesOf,
} from "@repo/domain/project/lottery";
import type {
  LotteryTransferOptionsQuery,
  LotteryTransferReceivingFieldsFragment,
} from "@repo/graphql";

import type { AllocationWarningItem } from "@/components/project/lottery/AllocationWarnings/allocation-warnings";

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

/**
 * 整本的張號區段(存值,例 `001-100`):到迄號(還沒標的跳號在拆本前還在區段裡;使用者 10/27 定案
 * 「001–101(100 張)」,張數另存)。
 */
export const wholeRangeOf = (book: TransferBookOption): string =>
  `001-${String(book.lastTicketNo).padStart(3, "0")}`;

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

/**
 * 選張加入:同一本已有選張的列就併進去(張號去重),已有整本 → 重複;
 * 那一列鎖住(編輯頁已出貨 / 已點收)→ 也算重複(鎖住的列不能改)。
 */
export const addPartial = (
  lines: readonly TransferDraftLine[],
  book: TransferBookOption,
  ticketNos: readonly string[],
  newRowId: () => string,
  locked: ReadonlySet<string> = new Set(),
): AddLineResult => {
  if (ticketNos.length === 0) {
    return { kind: "empty" };
  }
  const existing = lines.find((line) => line.book.bookId === book.bookId);
  if (
    existing?.mode === TRANSFER_MODE.whole ||
    (existing !== undefined && locked.has(existing.rowId))
  ) {
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

/** 刷到的碼找本的結果。 */
export type BookOfScanResult =
  | { kind: "found"; book: TransferBookOption; ticketNo: string }
  /** 正面的碼對到好幾款遊戲同本號,也沒選「正面條碼的遊戲」 */
  | { kind: "ambiguous_game" }
  | { kind: "not_found" };

/**
 * 刷到的碼 → 出貨店能調的哪一本、哪一張(`matchBookScan`):背面編號另比遊戲代號;正面的碼有選
 * 「正面條碼的遊戲」(`pickedGameId`)就只看那款遊戲,沒選而好幾款遊戲同本號 → `ambiguous_game`。
 */
export const bookOfScan = (
  books: readonly TransferBookOption[],
  raw: string,
  pickedGameId: string | null = null,
): BookOfScanResult => {
  const parsed = parseTicketInput(raw);
  if (parsed === null) {
    return { kind: "not_found" };
  }
  const matched = matchBookScan(
    books,
    { gameCode: parsed.gameCode ?? null, bookNo: parsed.bookNo },
    (item) => ({
      gameId: item.gameId,
      gameCode: item.gameCode,
      bookNo: item.bookNo,
    }),
    pickedGameId,
  );
  if (matched.kind === "ambiguous_game") {
    return { kind: "ambiguous_game" };
  }
  const book = matched.kind === "matched" ? matched.items[0] : undefined;
  return book === undefined
    ? { kind: "not_found" }
    : { kind: "found", book, ticketNo: parsed.ticketNo };
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
  keptLines: readonly Record<string, unknown>[] = [],
): StoredValues => ({
  [K.fromBranch]: header.fromBranchId === "" ? null : header.fromBranchId,
  [K.toBranch]: header.toBranchId === "" ? null : header.toBranchId,
  [K.requisition]: header.requisitionNo,
  [K.note]: header.note.trim() === "" ? null : header.note.trim(),
  [K.lines]: [
    ...lines.map((line): Record<string, unknown> => ({
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
    ...keptLines.map((line) => ({ ...line })),
  ],
});

/**
 * 超過收貨店預計要給本數的輸入(規格 7.6,只警告):整本一列算一本,零碎張數不湊成一本;
 * 這張單沒有整本調這個遊戲就不列。
 */
export const transferAllocationItemsOf = (
  allocations: TransferOptions["allocations"],
  lines: readonly TransferDraftLine[],
): AllocationWarningItem[] =>
  allocations.flatMap((allocation) => {
    const whole = lines.filter(
      (line) =>
        line.book.gameId === allocation.gameId &&
        line.mode === TRANSFER_MODE.whole,
    );
    const first = whole.at(0);
    return first === undefined
      ? []
      : [
          {
            key: allocation.gameId,
            label: `${first.book.gameCode} ${first.book.gameName}`,
            plannedBooks: allocation.plannedBooks ?? null,
            givenBooks: allocation.givenBooks,
            inTransitBooks: allocation.inTransitBooks,
            books: whole.length,
          },
        ];
  });

type ReceivingRow = LotteryTransferReceivingFieldsFragment["rows"][number];

/** 編輯頁帶入的內容。 */
export interface TransferFormState {
  header: TransferHeaderState;
  lines: TransferDraftLine[];
  /** 讀不到內容的明細列(讀不到本 / 遊戲):畫面列不出來,原樣存回 */
  keptLines: Record<string, unknown>[];
}

const labelOf = (value: unknown): string =>
  typeof value === "object" &&
  value !== null &&
  "label" in value &&
  typeof value.label === "string"
    ? value.label
    : "";

/**
 * 存值 → 畫面狀態(草稿 / 被退回帶入原內容;`transferValuesOf` 的反向):rowId、方式、張號、批購金額率照舊;
 * 本的事實(遊戲代號、本號)取點收區塊讀到的列(`receivingRows`),金額照存的(整本 = 整本金額、選張 = 面額 × 張數),
 * 所以帶入後金額不變。讀不到本 / 遊戲的列放 `keptLines` 原樣存回,不靜默丟掉。
 */
export const transferFormStateOf = (
  values: StoredValues,
  receivingRows: readonly ReceivingRow[],
): TransferFormState => {
  const record = values as Record<string, unknown>;
  const header = transferHeaderOf(record);
  const note = record[K.note];
  const rawLines = Array.isArray(record[K.lines])
    ? (record[K.lines] as unknown[])
    : [];
  const gameNameOf = new Map(
    rawLines.flatMap((row): [string, string][] =>
      typeof row === "object" &&
      row !== null &&
      "rowId" in row &&
      typeof row.rowId === "string"
        ? [[row.rowId, labelOf((row as Record<string, unknown>)[K.game])]]
        : [],
    ),
  );
  const rowOf = new Map(receivingRows.map((row) => [row.rowId, row]));
  /** 整本列存值的區段迄號(`001-101` → 101)。 */
  const wholeLastOf = new Map(
    rawLines.flatMap((row): [string, number][] => {
      if (typeof row !== "object" || row === null || !("rowId" in row)) {
        return [];
      }
      const text = (row as Record<string, unknown>)[K.ticketNos];
      const match = typeof text === "string" ? /-(\d{3})$/.exec(text) : null;
      return typeof row.rowId === "string" && match?.[1] !== undefined
        ? [[row.rowId, Number(match[1])]]
        : [];
    }),
  );
  const bookLabelOfRow = new Map(
    rawLines.flatMap((row): [string, string][] =>
      typeof row === "object" &&
      row !== null &&
      "rowId" in row &&
      typeof row.rowId === "string"
        ? [[row.rowId, labelOf((row as Record<string, unknown>)[K.book])]]
        : [],
    ),
  );
  /** 本的遊戲代號與本號:點收區塊讀到的列優先;讀不到時拆存值的本編號標籤(`5164-056527`)。 */
  const bookFactsOf = (
    rowId: string,
  ): { gameCode: string; bookNo: string; gameName: string } | null => {
    const row = rowOf.get(rowId);
    if (row !== undefined) {
      return {
        gameCode: row.gameCode,
        bookNo: row.bookNo,
        gameName: row.gameName,
      };
    }
    const match = /^(\d{4})-(\d{6})$/.exec(bookLabelOfRow.get(rowId) ?? "");
    if (match === null) {
      return null;
    }
    const [, gameCode = "", bookNo = ""] = match;
    return { gameCode, bookNo: `0${bookNo}`, gameName: "" };
  };
  const lines = transferLinesOf(record).flatMap((line): TransferDraftLine[] => {
    const row = bookFactsOf(line.rowId);
    if (row === null || line.gameId === null) {
      return [];
    }
    const isWhole = line.mode === TRANSFER_MODE.whole;
    return [
      {
        rowId: line.rowId,
        book: {
          bookId: line.bookId,
          gameId: line.gameId,
          gameCode: row.gameCode,
          gameName:
            row.gameName === ""
              ? (gameNameOf.get(line.rowId) ?? "")
              : row.gameName,
          bookNo: row.bookNo,
          unitPrice:
            line.tickets > 0 ? Math.round(line.amount / line.tickets) : 0,
          bookPrice: line.amount,
          rate: line.rate,
          isWhole,
          availableCount: line.tickets,
          lastTicketNo: isWhole
            ? (wholeLastOf.get(line.rowId) ?? line.tickets)
            : line.tickets,
        },
        mode: line.mode,
        ticketNos: isWhole ? [] : line.ticketNos,
        rate: line.rate,
      },
    ];
  });
  const lineRowIds = new Set(lines.map((line) => line.rowId));
  return {
    header: {
      fromBranchId: header.fromBranchId ?? "",
      toBranchId: header.toBranchId ?? "",
      requisitionNo: header.requisitionNo,
      note: typeof note === "string" ? note : "",
    },
    lines,
    keptLines: rawLines.filter(
      (row): row is Record<string, unknown> =>
        typeof row === "object" &&
        row !== null &&
        !lineRowIds.has(
          "rowId" in row && typeof row.rowId === "string" ? row.rowId : "",
        ),
    ),
  };
};
