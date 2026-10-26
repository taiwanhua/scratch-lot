import type { StoredValues } from "@repo/domain/form";
import {
  PURCHASE_FIELD_KEYS as K,
  displayBookNo,
  parseTicketInput,
  purchaseAmountOf,
  purchaseHeaderOf,
  purchaseLinesOf,
  referenceIdOf,
} from "@repo/domain/project/lottery";
import type { LotteryPurchaseOptionsQuery } from "@repo/graphql";

/**
 * 進貨單新增頁的純函式(規格 8.2;Figma PU-05):刷條碼加一本、依遊戲分組、批購金額率逐本 / 整組改
 * (改過的列標色)、從叫貨單帶入的「叫貨 N,已刷 M」、合計、組成表單存值。
 */
export type PurchaseOptions =
  LotteryPurchaseOptionsQuery["lotteryPurchaseOptions"];
export type PurchaseGame = PurchaseOptions["games"][number];

/** 刷進來的一本。 */
export interface ScannedBook {
  rowId: string;
  gameId: string;
  /** 7 位本號。 */
  bookNo: string;
  lastTicketNo: number;
  /** 批購金額率(整數 %)。 */
  rate: number;
  /**
   * 編輯頁鎖住的列(已點收):張數與整本金額照存的,不照遊戲現在的值重算
   * (api 以點收時建的本比對);沒有 = 照遊戲
   */
  stored?: { tickets: number; bookPrice: number };
}

export type AddBookResult =
  | { kind: "added"; books: ScannedBook[] }
  /** 看不懂的碼 */
  | { kind: "invalid" }
  /** 正面的碼沒有遊戲代號,也沒先選遊戲 */
  | { kind: "no_game" }
  /** 遊戲代號不是販售中的遊戲 */
  | { kind: "unknown_game"; gameCode: string }
  /** 這張單已經有這本 */
  | { kind: "duplicate"; bookNo: string };

/**
 * 刷一本(刷這本的最後一張):背面編號帶遊戲代號;正面的碼沒有遊戲代號時用 `fallbackGameId`
 * (畫面上先選的遊戲)。批購金額率預設遊戲的值。
 */
/** 各遊戲最後一次改整組的批購金額率(遊戲 id → 率;沒改過的遊戲不在裡面)。 */
export type GroupRates = ReadonlyMap<string, number>;

const NO_GROUP_RATES: GroupRates = new Map();

/** 新刷進的一本:那個遊戲改過整組率就沿用,沒改過用遊戲預設。 */
export const addScannedBook = (
  books: readonly ScannedBook[],
  raw: string,
  games: readonly PurchaseGame[],
  fallbackGameId: string | null,
  newRowId: () => string,
  groupRates: GroupRates = NO_GROUP_RATES,
): AddBookResult => {
  const parsed = parseTicketInput(raw);
  if (parsed === null) {
    return { kind: "invalid" };
  }
  const gameCode = parsed.gameCode;
  const game =
    gameCode === undefined
      ? games.find((item) => item.id === fallbackGameId)
      : games.find((item) => item.gameCode === gameCode);
  if (game === undefined) {
    return gameCode === undefined
      ? { kind: "no_game" }
      : { kind: "unknown_game", gameCode };
  }
  if (
    books.some(
      (book) => book.gameId === game.id && book.bookNo === parsed.bookNo,
    )
  ) {
    return { kind: "duplicate", bookNo: displayBookNo(parsed.bookNo) };
  }
  return {
    kind: "added",
    books: [
      ...books,
      {
        rowId: newRowId(),
        gameId: game.id,
        bookNo: parsed.bookNo,
        lastTicketNo: Number(parsed.ticketNo),
        rate: groupRates.get(game.id) ?? game.defaultRate,
      },
    ],
  };
};

/** 整組率只留還有本的遊戲(整組刪光後再刷,回到遊戲預設)。 */
export const pruneGroupRates = (
  groupRates: GroupRates,
  books: readonly ScannedBook[],
): GroupRates => {
  const gameIds = new Set(books.map((book) => book.gameId));
  return new Map([...groupRates].filter(([gameId]) => gameIds.has(gameId)));
};

/** 批購金額率的輸入 → 整數 0–100(和明細元件共用)。 */
export { parseRate } from "@/components/project/lottery/BookGroupList/parse-rate";

/** 逐本改批購金額率。 */
export const setBookRate = (
  books: readonly ScannedBook[],
  rowId: string,
  rate: number,
): ScannedBook[] =>
  books.map((book) => (book.rowId === rowId ? { ...book, rate } : book));

/** 組標題列一次改整組(編輯頁鎖住的列 `locked` 不動)。 */
export const setGroupRate = (
  books: readonly ScannedBook[],
  gameId: string,
  rate: number,
  locked: ReadonlySet<string> = new Set(),
): ScannedBook[] =>
  books.map((book) =>
    book.gameId === gameId && !locked.has(book.rowId)
      ? { ...book, rate }
      : book,
  );

export const removeBook = (
  books: readonly ScannedBook[],
  rowId: string,
): ScannedBook[] => books.filter((book) => book.rowId !== rowId);

/** 明細一列(畫面用):帶遊戲事實與批購金額、改過沒。 */
export interface BookRow extends ScannedBook {
  displayBookNo: string;
  tickets: number;
  bookPrice: number;
  amount: number;
  /** 批購金額率和遊戲預設不同(標色)。 */
  isRateEdited: boolean;
}

/** 一組(同一個遊戲)。 */
export interface BookGroup {
  game: PurchaseGame;
  rows: BookRow[];
  subtotal: number;
  /** 從叫貨單帶入時叫了幾本;沒有叫貨單或沒叫這個遊戲 = null。 */
  requestedBooks: number | null;
}

/**
 * 依遊戲分組(順序照第一次刷到);叫貨單有叫、還沒刷到的遊戲也列一組(已刷 0)。
 * `games` 找不到的遊戲(例:編輯頁裡已點收、後來停售的遊戲)用 `extraGames` 補,不讓那幾本消失。
 */
export const groupBooks = (
  books: readonly ScannedBook[],
  games: readonly PurchaseGame[],
  requested: ReadonlyMap<string, number> | null,
  extraGames: readonly PurchaseGame[] = [],
): BookGroup[] => {
  const gameOf = new Map(
    [...extraGames, ...games].map((game) => [game.id, game]),
  );
  const order = [
    ...new Set([
      ...books.map((book) => book.gameId),
      ...(requested === null ? [] : requested.keys()),
    ]),
  ];
  return order.flatMap((gameId) => {
    const game = gameOf.get(gameId);
    if (game === undefined) {
      return [];
    }
    const rows = books
      .filter((book) => book.gameId === gameId)
      .map((book) => ({
        ...book,
        displayBookNo: displayBookNo(book.bookNo),
        tickets: book.stored?.tickets ?? game.ticketsPerBook,
        bookPrice: book.stored?.bookPrice ?? game.bookPrice,
        amount: purchaseAmountOf(
          book.stored?.bookPrice ?? game.bookPrice,
          book.rate,
        ),
        isRateEdited: book.rate !== game.defaultRate,
      }));
    return [
      {
        game,
        rows,
        subtotal: rows.reduce((sum, row) => sum + row.amount, 0),
        requestedBooks: requested?.get(gameId) ?? null,
      },
    ];
  });
};

/** 批購合計(= 扣款金額;兌獎折抵由兌獎的功能加)。 */
export const purchaseTotalOf = (groups: readonly BookGroup[]): number =>
  groups.reduce((sum, group) => sum + group.subtotal, 0);

/** 叫貨單帶入:「叫貨 N,已刷 M」(標題旁);沒有叫貨單 → null。 */
export const requisitionProgressOf = (
  groups: readonly BookGroup[],
): { requested: number; scanned: number } | null => {
  const requested = groups.filter((group) => group.requestedBooks !== null);
  if (requested.length === 0) {
    return null;
  }
  return {
    requested: requested.reduce(
      (sum, group) => sum + (group.requestedBooks ?? 0),
      0,
    ),
    scanned: requested.reduce((sum, group) => sum + group.rows.length, 0),
  };
};

/** 單頭(新增頁的狀態)。 */
export interface PurchaseHeaderState {
  branchId: string;
  requisitionNo: string | null;
  dealerId: string | null;
  selfPurchase: boolean;
  trusteeId: string | null;
  /** 批購日期(時點 ISO,當地 00:00) */
  purchaseDate: string | null;
  accountId: string | null;
  note: string;
}

/** 勾選的一筆兌獎紀錄(規格 8.2「兌獎」;`rowId` 在勾選時產生)。 */
export interface PickedRedemption {
  rowId: string;
  id: string;
  /** 張編號 `5164-056527-031`(引用欄的標籤) */
  label: string;
  prizeAmount: number;
}

/** 勾 / 取消勾一筆(同一筆再按 = 取消)。 */
export const toggleRedemption = (
  picked: readonly PickedRedemption[],
  row: Omit<PickedRedemption, "rowId">,
  newRowId: () => string,
): PickedRedemption[] =>
  picked.some((item) => item.id === row.id)
    ? picked.filter((item) => item.id !== row.id)
    : [...picked, { ...row, rowId: newRowId() }];

/**
 * 表單存值(受管表單 `purchase` r3):單頭 + 明細(張數、整本金額照遊戲;批購金額由列內公式算)+
 * 勾選的兌獎紀錄(合計三列與扣款金額由計算欄算)。
 */
export const purchaseValuesOf = (
  header: PurchaseHeaderState,
  groups: readonly BookGroup[],
  redemptions: readonly PickedRedemption[] = [],
  keptLines: readonly Record<string, unknown>[] = [],
): StoredValues => ({
  [K.branch]: header.branchId === "" ? null : header.branchId,
  [K.requisition]: header.requisitionNo,
  [K.dealer]: header.dealerId,
  [K.selfPurchase]: header.selfPurchase,
  [K.trustee]: header.selfPurchase ? null : header.trusteeId,
  [K.purchaseDate]: header.purchaseDate,
  [K.account]: header.accountId,
  [K.note]: header.note.trim() === "" ? null : header.note.trim(),
  [K.lines]: [
    ...groups.flatMap((group) =>
      group.rows.map((row): Record<string, unknown> => ({
        rowId: row.rowId,
        [K.game]: { id: group.game.id, label: group.game.name },
        [K.bookNo]: row.bookNo,
        [K.lastTicketNo]: row.lastTicketNo,
        [K.tickets]: row.tickets,
        [K.bookPrice]: row.bookPrice,
        [K.rate]: row.rate,
      })),
    ),
    ...keptLines.map((line) => ({ ...line })),
  ],
  [K.redemptions]: redemptions.map((item) => ({
    rowId: item.rowId,
    [K.redemption]: { id: item.id, label: item.label },
    [K.prizeAmount]: item.prizeAmount,
  })),
});

/** 扣款帳戶只有一個時自動帶入。 */
export const defaultAccountOf = (
  accounts: readonly { id: string }[],
): string | null => (accounts.length === 1 ? (accounts[0]?.id ?? null) : null);

/** 編輯頁帶入的內容(存值 → 新增頁的畫面狀態)。 */
export interface PurchaseFormState {
  header: {
    branchId: string;
    requisitionNo: string | null;
    dealerId: string | null;
    selfPurchase: boolean;
    trusteeId: string | null;
    /** 批購日期(時點 ISO);沒有 = null */
    purchaseDate: string | null;
    accountId: string | null;
    note: string;
  };
  books: ScannedBook[];
  redemptions: PickedRedemption[];
  /** 讀不到內容的明細列(例 本號格式不對):畫面列不出來,原樣存回 */
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
 * 存值 → 畫面狀態(草稿 / 被退回帶入原內容;`purchaseValuesOf` 的反向):明細的 rowId 照舊
 * (api 用 rowId 比對已點收的列)、批購金額率、張數與整本金額照存的(`stored`;只有鎖住的列會用);
 * 讀不到內容的列(沒有 rowId / 遊戲、本號格式不對)放 `keptLines` 原樣存回,不靜默丟掉。
 */
export const purchaseFormStateOf = (
  values: StoredValues,
): PurchaseFormState => {
  const record = values as Record<string, unknown>;
  const header = purchaseHeaderOf(record);
  const note = record[K.note];
  const rows = record[K.redemptions];
  const rawLines = (
    Array.isArray(record[K.lines]) ? (record[K.lines] as unknown[]) : []
  ).filter(
    (line): line is Record<string, unknown> =>
      typeof line === "object" && line !== null && !Array.isArray(line),
  );
  const books: ScannedBook[] = purchaseLinesOf(record).flatMap((line) =>
    line.bookNo === null
      ? []
      : [
          {
            rowId: line.rowId,
            gameId: line.gameId,
            bookNo: line.bookNo,
            lastTicketNo: line.lastTicketNo,
            rate: line.rate,
            stored: { tickets: line.tickets, bookPrice: line.bookPrice },
          },
        ],
  );
  const bookRowIds = new Set(books.map((book) => book.rowId));
  return {
    header: {
      branchId: header.branchId ?? "",
      requisitionNo: header.requisitionNo,
      dealerId: header.dealerId,
      selfPurchase: header.selfPurchase,
      trusteeId: header.trusteeId,
      purchaseDate: header.purchaseDate?.toISOString() ?? null,
      accountId: header.accountId,
      note: typeof note === "string" ? note : "",
    },
    books,
    keptLines: rawLines.filter(
      (line) =>
        !bookRowIds.has(typeof line.rowId === "string" ? line.rowId : ""),
    ),
    redemptions: (Array.isArray(rows) ? rows : []).flatMap(
      (row: unknown): PickedRedemption[] => {
        if (typeof row !== "object" || row === null) {
          return [];
        }
        const item = row as Record<string, unknown>;
        const ref = item[K.redemption];
        const id = referenceIdOf(ref);
        if (id === null || typeof item.rowId !== "string") {
          return [];
        }
        return [
          {
            rowId: item.rowId,
            id,
            label: labelOf(ref),
            prizeAmount: Number(item[K.prizeAmount] ?? 0),
          },
        ];
      },
    ),
  };
};

/** 存的張數 / 整本金額只留給鎖住的列(已點收);其他列照遊戲現在的值重算。 */
export const storedOnlyForLocked = (
  books: readonly ScannedBook[],
  locked: ReadonlySet<string>,
): ScannedBook[] =>
  books.map((book) =>
    locked.has(book.rowId) || book.stored === undefined
      ? book
      : {
          rowId: book.rowId,
          gameId: book.gameId,
          bookNo: book.bookNo,
          lastTicketNo: book.lastTicketNo,
          rate: book.rate,
        },
  );
