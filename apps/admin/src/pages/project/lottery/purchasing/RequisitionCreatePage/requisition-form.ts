import type { StoredValues } from "@repo/domain/form";
import {
  REQUISITION_FIELD_KEYS,
  allocationExcessOf,
  estimatedPurchaseAmountOf,
  referenceIdOf,
} from "@repo/domain/project/lottery";
import type { LotteryRequisitionCandidateFieldsFragment } from "@repo/graphql";

/**
 * 叫貨單新增頁的純函式(規格 8.1;Figma PU-02):篩選、合計、超過預計要給本數、組成表單存值。
 * 「叫幾本」以遊戲 id 為鍵存在畫面狀態;0 本的列不寫入(組存值時略過)。
 */
export type Candidate = LotteryRequisitionCandidateFieldsFragment;

/** 每個遊戲叫幾本(gameId → 本數;沒填 = 0)。 */
export type BookCounts = Readonly<Record<string, number>>;

export interface CandidateFilters {
  /** 搜尋遊戲名稱或代號(部分比對,不分大小寫) */
  keyword: string;
  /** 面額;null = 全部 */
  unitPrice: number | null;
  /** 只看要叫的(叫幾本 > 0) */
  onlyOrdered: boolean;
}

export const EMPTY_FILTERS: CandidateFilters = {
  keyword: "",
  unitPrice: null,
  onlyOrdered: false,
};

const booksOf = (counts: BookCounts, gameId: string): number =>
  counts[gameId] ?? 0;

/** 畫面上看得到的列(順序照 api 排好的)。 */
export const visibleCandidates = (
  rows: readonly Candidate[],
  counts: BookCounts,
  filters: CandidateFilters,
): Candidate[] => {
  const keyword = filters.keyword.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (keyword === "" ||
        row.name.toLowerCase().includes(keyword) ||
        row.gameCode.includes(keyword)) &&
      (filters.unitPrice === null || row.unitPrice === filters.unitPrice) &&
      (!filters.onlyOrdered || booksOf(counts, row.gameId) > 0),
  );
};

/** 面額篩選的選項(列裡出現過的面額,小到大)。 */
export const unitPricesOf = (rows: readonly Candidate[]): number[] =>
  [...new Set(rows.map((row) => row.unitPrice))].toSorted(
    (left, right) => left - right,
  );

/** 底部合計:共叫幾本、預估批購金額(同採購清單的算法)。 */
export const totalsOf = (
  rows: readonly Candidate[],
  counts: BookCounts,
): { books: number; amount: number } => {
  const ordered = rows.filter((row) => booksOf(counts, row.gameId) > 0);
  return {
    books: ordered.reduce((sum, row) => sum + booksOf(counts, row.gameId), 0),
    amount: estimatedPurchaseAmountOf(
      ordered.map((row) => ({
        bookPrice: row.bookPrice,
        defaultRate: row.defaultRate,
        books: booksOf(counts, row.gameId),
      })),
    ),
  };
};

/** 這一列超過預計要給本數幾本(只提醒、可送出)。 */
export const excessOf = (row: Candidate, counts: BookCounts): number =>
  allocationExcessOf({
    plannedBooks: row.plannedBooks ?? null,
    givenBooks: row.givenBooks,
    inTransitBooks: row.inTransitBooks,
    books: booksOf(counts, row.gameId),
  });

export interface RequisitionHeader {
  /** 叫貨分店 id;空字串 = 還沒選 */
  branchId: string;
  /** 期望到貨日(時點 ISO);null = 不填 */
  expectedDate: string | null;
}

/** 編輯頁帶入、畫面不改但要原樣存回的內容(新增頁沒有)。 */
export interface RequisitionKeptValues {
  /** 單頭備註 */
  note: string | null;
  /** 明細備註(遊戲 id → 備註) */
  lineNotes: ReadonlyMap<string, string>;
  /** 不在販售中遊戲清單的列(停售):原樣存回 */
  otherLines: readonly RequisitionOtherLine[];
}

/** 帶入的一列、但遊戲不在販售中清單裡(畫面列不出來)。 */
export interface RequisitionOtherLine {
  rowId: string;
  gameId: string;
  /** 遊戲的引用標籤(提示用) */
  label: string;
  books: number;
  note: string | null;
}

/**
 * 表單存值(受管表單 `requisition`):叫貨分店、期望到貨日、明細(本數 > 0 的遊戲)。
 * 明細的 `rowId` 由 `rowIdOf` 依遊戲取(同一個遊戲每次存草稿用同一個 rowId)。
 * 編輯頁另給 `kept`:單頭備註、明細備註、停售遊戲的列原樣存回。
 */
export const requisitionValuesOf = (
  header: RequisitionHeader,
  rows: readonly Candidate[],
  counts: BookCounts,
  rowIdOf: (gameId: string) => string,
  kept: RequisitionKeptValues | null = null,
): StoredValues => ({
  [REQUISITION_FIELD_KEYS.branch]:
    header.branchId === "" ? null : header.branchId,
  [REQUISITION_FIELD_KEYS.expectedDate]: header.expectedDate,
  ...(kept !== null && { [REQUISITION_FIELD_KEYS.note]: kept.note }),
  [REQUISITION_FIELD_KEYS.lines]: [
    ...rows
      .filter((row) => booksOf(counts, row.gameId) > 0)
      .map((row) => {
        const note = kept?.lineNotes.get(row.gameId);
        return {
          rowId: rowIdOf(row.gameId),
          [REQUISITION_FIELD_KEYS.game]: { id: row.gameId, label: row.name },
          [REQUISITION_FIELD_KEYS.books]: booksOf(counts, row.gameId),
          ...(note !== undefined && {
            [REQUISITION_FIELD_KEYS.lineNote]: note,
          }),
        };
      }),
    ...(kept?.otherLines ?? []).map((line) => ({
      rowId: line.rowId,
      [REQUISITION_FIELD_KEYS.game]: { id: line.gameId, label: line.label },
      [REQUISITION_FIELD_KEYS.books]: line.books,
      [REQUISITION_FIELD_KEYS.lineNote]: line.note,
    })),
  ],
});

/** 新增 / 編輯畫面帶入的內容。 */
export interface RequisitionFormState extends RequisitionKeptValues {
  branchId: string;
  /** 期望到貨日(時點 ISO);沒填 = null */
  expectedDate: string | null;
  counts: BookCounts;
  /** 遊戲 id → 原本的 rowId */
  rowIds: ReadonlyMap<string, string>;
}

/** 新增頁的初始內容。 */
export const emptyRequisitionState = (
  branchId: string,
): RequisitionFormState => ({
  branchId,
  expectedDate: null,
  counts: {},
  rowIds: new Map(),
  note: null,
  lineNotes: new Map(),
  otherLines: [],
});

/** 存的本數(數字或數字字串)→ 本數;其他 = 0。 */
const storedBooksOf = (value: unknown): number => {
  if (typeof value === "number") {
    return parseBooks(String(value));
  }
  return typeof value === "string" ? parseBooks(value) : 0;
};

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const labelOf = (value: unknown): string =>
  typeof value === "object" &&
  value !== null &&
  "label" in value &&
  typeof value.label === "string"
    ? value.label
    : "";

/**
 * 存值 → 畫面狀態(草稿 / 被退回帶入原內容;`requisitionValuesOf` 的反向)。`onSale` = 販售中的遊戲 id
 * (讀到候選清單後才知道);不在裡面的列放 `otherLines` 原樣保留。同一個遊戲兩列只取第一列。
 */
export const requisitionFormStateOf = (
  values: StoredValues,
  onSale: ReadonlySet<string>,
): RequisitionFormState => {
  const record = values as Record<string, unknown>;
  const lines = record[REQUISITION_FIELD_KEYS.lines];
  const counts: Record<string, number> = {};
  const rowIds = new Map<string, string>();
  const lineNotes = new Map<string, string>();
  const otherLines: RequisitionOtherLine[] = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    if (typeof line !== "object" || line === null) {
      continue;
    }
    const row = line as Record<string, unknown>;
    const gameId = referenceIdOf(row[REQUISITION_FIELD_KEYS.game]);
    if (
      gameId === null ||
      typeof row.rowId !== "string" ||
      rowIds.has(gameId)
    ) {
      continue;
    }
    const books = storedBooksOf(row[REQUISITION_FIELD_KEYS.books]);
    const note = textOf(row[REQUISITION_FIELD_KEYS.lineNote]);
    rowIds.set(gameId, row.rowId);
    if (!onSale.has(gameId)) {
      otherLines.push({
        rowId: row.rowId,
        gameId,
        label: labelOf(row[REQUISITION_FIELD_KEYS.game]),
        books,
        note,
      });
      continue;
    }
    counts[gameId] = books;
    if (note !== null) {
      lineNotes.set(gameId, note);
    }
  }
  return {
    branchId: referenceIdOf(record[REQUISITION_FIELD_KEYS.branch]) ?? "",
    expectedDate: textOf(record[REQUISITION_FIELD_KEYS.expectedDate]),
    counts,
    rowIds,
    note: textOf(record[REQUISITION_FIELD_KEYS.note]),
    lineNotes,
    otherLines,
  };
};

/** 銷售欄:新遊戲還沒賣過顯示「—」(api 給 null),其他千分位。 */
export const salesText = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : value.toLocaleString("en-US");

/** 叫幾本的輸入 → 本數(空白、負數、非整數一律當 0)。 */
export const parseBooks = (raw: string): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 999) : 0;
};
