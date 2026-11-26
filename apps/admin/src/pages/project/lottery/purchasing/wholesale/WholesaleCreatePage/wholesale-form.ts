import type { StoredValues } from "@repo/domain/form";
import {
  WHOLESALE_FIELD_KEYS as K,
  WHOLESALE_PAYMENT_MODE,
  type WholesalePaymentMode,
  displayBookKey,
  matchBookScan,
  parseTicketInput,
  wholesaleAmountOf,
  wholesaleHeaderOf,
  wholesaleLinesOf,
} from "@repo/domain/project/lottery";
import type {
  LotteryWholesaleDetailQuery,
  LotteryWholesaleOptionsQuery,
} from "@repo/graphql";

/**
 * 批售單新增頁的純函式(規格 21.3;Figma WS-02):加入本、刷條碼找本、批購金額率逐本 / 整組改、依遊戲分組、合計、
 * 原成本與預估獲利、組成表單存值。
 */
export type WholesaleOptions =
  LotteryWholesaleOptionsQuery["lotteryWholesaleOptions"];
type OptionBook = WholesaleOptions["books"][number];

/** 明細上的本(選項的本,或編輯頁帶入的列)。 */
export type WholesaleBookOption = Pick<
  OptionBook,
  | "bookId"
  | "gameId"
  | "gameCode"
  | "gameName"
  | "bookNo"
  | "unitPrice"
  | "tickets"
  | "bookPrice"
  | "defaultRate"
>;

/** 明細的一列(畫面狀態;一列 = 一整本)。 */
export interface WholesaleDraftLine {
  rowId: string;
  book: WholesaleBookOption;
  /** 批購金額率(整數 %;預設遊戲的預設批購金額率) */
  rate: number;
}

/** 各遊戲的整組批購金額率(改過整組的才有;之後加入的同遊戲的本沿用)。 */
export type GroupRates = ReadonlyMap<string, number>;

export const lineAmountOf = (line: WholesaleDraftLine): number =>
  wholesaleAmountOf(line.book.bookPrice, line.rate);

/** 批售金額 = 明細批售金額合計。 */
export const draftTotalOf = (lines: readonly WholesaleDraftLine[]): number =>
  lines.reduce((sum, line) => sum + lineAmountOf(line), 0);

/** 加入幾本(已在明細的略過);率 = 那款遊戲改過的整組率,沒改過 = 遊戲的預設。 */
export const addBooks = (
  lines: readonly WholesaleDraftLine[],
  books: readonly WholesaleBookOption[],
  groupRates: GroupRates,
  newRowId: () => string,
): WholesaleDraftLine[] => {
  const present = new Set(lines.map((line) => line.book.bookId));
  return [
    ...lines,
    ...books
      .filter((book) => !present.has(book.bookId))
      .map((book) => ({
        rowId: newRowId(),
        book,
        rate: groupRates.get(book.gameId) ?? book.defaultRate,
      })),
  ];
};

export const setLineRate = (
  lines: readonly WholesaleDraftLine[],
  rowId: string,
  rate: number,
): WholesaleDraftLine[] =>
  lines.map((line) => (line.rowId === rowId ? { ...line, rate } : line));

/** 整組改:那款遊戲每一本都套用。 */
export const setGameRate = (
  lines: readonly WholesaleDraftLine[],
  gameId: string,
  rate: number,
): WholesaleDraftLine[] =>
  lines.map((line) => (line.book.gameId === gameId ? { ...line, rate } : line));

export const removeLine = (
  lines: readonly WholesaleDraftLine[],
  rowId: string,
): WholesaleDraftLine[] => lines.filter((line) => line.rowId !== rowId);

/** 依遊戲分組(順序照第一次加入)。 */
export const groupLines = (
  lines: readonly WholesaleDraftLine[],
): { book: WholesaleBookOption; lines: WholesaleDraftLine[] }[] => {
  const groups = new Map<
    string,
    { book: WholesaleBookOption; lines: WholesaleDraftLine[] }
  >();
  for (const line of lines) {
    const group = groups.get(line.book.gameId) ?? {
      book: line.book,
      lines: [],
    };
    group.lines.push(line);
    groups.set(line.book.gameId, group);
  }
  return [...groups.values()];
};

/** 刷到的碼找本的結果。 */
export type ScanResult =
  | { kind: "found"; book: OptionBook }
  /** 正面的碼對到好幾款遊戲同本號,也沒選「正面條碼的遊戲」 */
  | { kind: "ambiguous" }
  /** 不在可批售的本裡:去問為什麼 */
  | { kind: "unavailable"; gameCode: string | null; bookNo: string }
  /** 看不懂的碼 */
  | { kind: "invalid" };

/** 刷到的碼 → 可批售的哪一本(背面編號另比遊戲代號;正面的碼照「正面條碼的遊戲」)。 */
export const scanBook = (
  books: readonly OptionBook[],
  raw: string,
  pickedGameId: string | null,
): ScanResult => {
  const parsed = parseTicketInput(raw);
  if (parsed === null) {
    return { kind: "invalid" };
  }
  const gameCode = parsed.gameCode ?? null;
  const matched = matchBookScan(
    books,
    { gameCode, bookNo: parsed.bookNo },
    (item) => ({
      gameId: item.gameId,
      gameCode: item.gameCode,
      bookNo: item.bookNo,
    }),
    pickedGameId,
  );
  if (matched.kind === "ambiguous_game") {
    return { kind: "ambiguous" };
  }
  const book = matched.kind === "matched" ? matched.items[0] : undefined;
  return book === undefined
    ? { kind: "unavailable", gameCode, bookNo: parsed.bookNo }
    : { kind: "found", book };
};

/**
 * 原成本與預估獲利(有 `inventory.show-cost` 才有成本):每一本的成本都讀得到才算,缺任何一本 → null。
 */
export const profitOf = (
  lines: readonly WholesaleDraftLine[],
  books: readonly Pick<OptionBook, "bookId" | "cost">[],
): { cost: number; profit: number } | null => {
  const costOf = new Map(books.map((book) => [book.bookId, book.cost]));
  let cost = 0;
  for (const line of lines) {
    const own = costOf.get(line.book.bookId);
    if (own === undefined || own === null) {
      return null;
    }
    cost += own;
  }
  return lines.length === 0
    ? null
    : { cost, profit: draftTotalOf(lines) - cost };
};

/** 入帳帳戶只有一個可用時自動帶入。 */
export const defaultAccountOf = (
  accounts: WholesaleOptions["accounts"],
): string | null => (accounts.length === 1 ? (accounts[0]?.id ?? null) : null);

/** 單頭的畫面狀態。 */
export interface WholesaleHeaderState {
  fromBranchId: string;
  customerId: string | null;
  paymentMode: WholesalePaymentMode;
  accountId: string | null;
  note: string;
}

/** 表單存值(受管表單 `wholesale`):單頭 + 明細(批售金額由列內公式算);收到錢再核准不帶入帳帳戶。 */
export const wholesaleValuesOf = (
  header: WholesaleHeaderState,
  lines: readonly WholesaleDraftLine[],
  keptLines: readonly Record<string, unknown>[] = [],
): StoredValues => ({
  [K.fromBranch]: header.fromBranchId === "" ? null : header.fromBranchId,
  [K.customer]: header.customerId,
  [K.paymentMode]: header.paymentMode,
  [K.account]:
    header.paymentMode === WHOLESALE_PAYMENT_MODE.autoBank
      ? header.accountId
      : null,
  [K.note]: header.note.trim() === "" ? null : header.note.trim(),
  [K.lines]: [
    ...lines.map((line): Record<string, unknown> => ({
      rowId: line.rowId,
      [K.game]: { id: line.book.gameId, label: line.book.gameName },
      [K.book]: {
        id: line.book.bookId,
        label: displayBookKey(line.book.gameCode, line.book.bookNo),
      },
      [K.tickets]: line.book.tickets,
      [K.bookPrice]: line.book.bookPrice,
      [K.rate]: line.rate,
    })),
    ...keptLines.map((line) => ({ ...line })),
  ],
});

/** 編輯頁帶入的內容。 */
export interface WholesaleFormState {
  header: WholesaleHeaderState;
  lines: WholesaleDraftLine[];
  /** 讀不到內容的明細列(讀不到本 / 遊戲):畫面列不出來,原樣存回 */
  keptLines: Record<string, unknown>[];
}

type DetailRow =
  LotteryWholesaleDetailQuery["lotteryWholesaleDetail"]["rows"][number];

/** 存值 → 畫面狀態(草稿 / 被退回帶入原內容;`wholesaleValuesOf` 的反向);本的事實取檢視內容讀到的列。 */
export const wholesaleFormStateOf = (
  values: StoredValues,
  rows: readonly DetailRow[],
): WholesaleFormState => {
  const record = values as Record<string, unknown>;
  const header = wholesaleHeaderOf(record);
  const note = record[K.note];
  const rowOf = new Map(rows.map((row) => [row.rowId, row]));
  const lines = wholesaleLinesOf(record).flatMap((line) => {
    const row = rowOf.get(line.rowId);
    return row === undefined
      ? []
      : [{ rowId: line.rowId, book: row, rate: line.rate }];
  });
  const known = new Set(lines.map((line) => line.rowId));
  const rawLines = Array.isArray(record[K.lines])
    ? (record[K.lines] as unknown[])
    : [];
  return {
    header: {
      fromBranchId: header.fromBranchId ?? "",
      customerId: header.customerId,
      paymentMode: header.paymentMode ?? WHOLESALE_PAYMENT_MODE.collectFirst,
      accountId: header.accountId,
      note: typeof note === "string" ? note : "",
    },
    lines,
    keptLines: rawLines.filter(
      (row): row is Record<string, unknown> =>
        typeof row === "object" &&
        row !== null &&
        !known.has(
          "rowId" in row && typeof row.rowId === "string" ? row.rowId : "",
        ),
    ),
  };
};
