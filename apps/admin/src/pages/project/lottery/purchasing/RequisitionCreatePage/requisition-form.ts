import type { StoredValues } from "@repo/domain/form";
import {
  REQUISITION_FIELD_KEYS,
  allocationExcessOf,
  estimatedPurchaseAmountOf,
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

/**
 * 表單存值(受管表單 `requisition`):叫貨分店、期望到貨日、明細(本數 > 0 的遊戲)。
 * 明細的 `rowId` 由 `rowIdOf` 依遊戲取(同一個遊戲每次存草稿用同一個 rowId)。
 */
export const requisitionValuesOf = (
  header: RequisitionHeader,
  rows: readonly Candidate[],
  counts: BookCounts,
  rowIdOf: (gameId: string) => string,
): StoredValues => ({
  [REQUISITION_FIELD_KEYS.branch]:
    header.branchId === "" ? null : header.branchId,
  [REQUISITION_FIELD_KEYS.expectedDate]: header.expectedDate,
  [REQUISITION_FIELD_KEYS.lines]: rows
    .filter((row) => booksOf(counts, row.gameId) > 0)
    .map((row) => ({
      rowId: rowIdOf(row.gameId),
      [REQUISITION_FIELD_KEYS.game]: { id: row.gameId, label: row.name },
      [REQUISITION_FIELD_KEYS.books]: booksOf(counts, row.gameId),
    })),
});

/** 銷售欄:新遊戲還沒賣過顯示「—」(api 給 null),其他千分位。 */
export const salesText = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : value.toLocaleString("en-US");

/** 叫幾本的輸入 → 本數(空白、負數、非整數一律當 0)。 */
export const parseBooks = (raw: string): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 999) : 0;
};
