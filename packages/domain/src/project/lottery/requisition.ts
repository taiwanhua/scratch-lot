/**
 * 叫貨單(專案規格 8.1;正本 `docs/modules/project/purchasing.md`「叫貨單」):api 的副本、新增頁的資料
 * 與 admin 的新增頁共用的常數與純函式 —— 表單代號 / 欄位 key、新遊戲、銷售欄、排序、預估批購金額、
 * 超過預計要給本數、明細存值 → 副本列。
 */

/** 叫貨單綁定的模組與表單代號(規格 2.1)。 */
export const REQUISITION_MODULE_KEY = "purchasing.requisition";
export const REQUISITION_FORM_KEY = "requisition";

/** 受管表單 `requisition` 的欄位 key(`seeds/project/revisions/requisition.r1.seed.ts`)。 */
export const REQUISITION_FIELD_KEYS = {
  /** 叫貨分店(組織引用) */
  branch: "branch",
  /** 期望到貨日(選填) */
  expectedDate: "expected_date",
  /** 明細(遊戲 × 本數 × 備註) */
  lines: "lines",
  /** 明細子欄:遊戲(引用 `lottery_game`) */
  game: "game",
  /** 明細子欄:本數 */
  books: "books",
  /** 明細子欄:備註 */
  lineNote: "note",
  /** 本數合計(計算欄;列表的「本數」) */
  totalBooks: "total_books",
  /** 備註 */
  note: "note",
} as const;

/** 叫貨單的衍生狀態(引擎狀態「已完成」再細分;規格 8.1)。 */
export const REQUISITION_STATES = [
  "pending",
  "purchased",
  "transferred",
] as const;
export type RequisitionState = (typeof REQUISITION_STATES)[number];

/** 引用叫貨單的單據:進貨單 / 調貨單(一張叫貨單只能對應一張)。 */
export const REQUISITION_REFERENCE_TYPES = ["purchase", "transfer"] as const;
export type RequisitionReferenceType =
  (typeof REQUISITION_REFERENCE_TYPES)[number];

/** 引用類型 → 衍生狀態。 */
export function requisitionStateOf(
  referenceType: RequisitionReferenceType | null,
): RequisitionState {
  if (referenceType === "purchase") {
    return "purchased";
  }
  return referenceType === "transfer" ? "transferred" : "pending";
}

/** 新遊戲 = 上市 30 天內(含當天;上市日在未來也算)。 */
export const NEW_GAME_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 上市 30 天內是新遊戲;沒填上市日不是。 */
export function isNewGame(launchedAt: Date | null, now: Date): boolean {
  if (launchedAt === null) {
    return false;
  }
  return now.getTime() - launchedAt.getTime() <= NEW_GAME_DAYS * DAY_MS;
}

/** 近 7 / 30 天的統計期間(滾動,以毫秒算)。 */
export const RECENT_SALES_DAYS = [7, 30] as const;

/** 近 N 天的起點。 */
export function recentSalesSince(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * 銷售欄的值:新遊戲還沒賣過 → null(畫面顯示「—」,不是 0);其他照實際張數。
 */
export function recentSalesOf(isNew: boolean, sold: number): number | null {
  return isNew && sold === 0 ? null : sold;
}

/** 排序用的欄位。 */
export interface RequisitionCandidateOrder {
  gameCode: string;
  launchedAt: Date | null;
  /** 近 30 天賣出張數(新遊戲還沒賣過 = null,排序視為 0)。 */
  sold30: number | null;
}

/**
 * 新增頁的遊戲順序(規格 8.1):新遊戲排最上(上市日新到舊),其他依近 30 天賣出多到少;
 * 同順位依遊戲代號。回新陣列,不改傳入的。
 */
export function sortRequisitionCandidates<T extends RequisitionCandidateOrder>(
  rows: readonly T[],
  now: Date,
): T[] {
  const byCode = (left: T, right: T): number =>
    left.gameCode.localeCompare(right.gameCode, "zh-Hant");
  return [...rows].sort((left, right) => {
    const leftNew = isNewGame(left.launchedAt, now);
    const rightNew = isNewGame(right.launchedAt, now);
    if (leftNew !== rightNew) {
      return leftNew ? -1 : 1;
    }
    if (leftNew) {
      const diff =
        (right.launchedAt?.getTime() ?? 0) - (left.launchedAt?.getTime() ?? 0);
      return diff === 0 ? byCode(left, right) : diff;
    }
    const diff = (right.sold30 ?? 0) - (left.sold30 ?? 0);
    return diff === 0 ? byCode(left, right) : diff;
  });
}

/** 預估批購金額的一列:遊戲整本金額、預設批購金額率(整數 %)、本數。 */
export interface EstimateLine {
  bookPrice: number;
  defaultRate: number;
  books: number;
}

/** 預估批購金額 = Σ(整本金額 × 預設批購金額率 × 本數),加總後四捨五入到元(採購清單同一算法)。 */
export function estimatedPurchaseAmountOf(
  lines: readonly EstimateLine[],
): number {
  const total = lines.reduce(
    (sum, line) => sum + (line.bookPrice * line.defaultRate * line.books) / 100,
    0,
  );
  return Math.round(total);
}

/** 超過預計要給本數的輸入。 */
export interface AllocationExcessInput {
  /** 預計要給本數;沒設定 = null(不提醒)。 */
  plannedBooks: number | null;
  /** 已給(整本)。 */
  givenBooks: number;
  /** 在途本數。 */
  inTransitBooks: number;
  /** 這次叫幾本。 */
  books: number;
}

/**
 * 超過幾本(只提醒、可送出;規格 7.6、8.1):已給 + 在途 + 這次叫的 − 預計;
 * 這次沒叫、沒設定預計、沒超過 → 0。
 */
export function allocationExcessOf(input: AllocationExcessInput): number {
  if (input.plannedBooks === null || input.books <= 0) {
    return 0;
  }
  return Math.max(
    0,
    input.givenBooks + input.inTransitBooks + input.books - input.plannedBooks,
  );
}

/** 副本的一列(分店另外給)。 */
export interface RequisitionLineValue {
  gameId: string;
  books: number;
  note: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 引用欄的存值(`{ id, label }` 或 id 字串)→ id。 */
export function referenceIdOf(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (isRecord(value) && typeof value.id === "string" && value.id !== "") {
    return value.id;
  }
  return null;
}

function booksOf(value: unknown): number {
  const number =
    typeof value === "number" ? value : Number(value ?? Number.NaN);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

/**
 * 叫貨單的存值 → 副本列:本數不是正整數(0、空)的列不寫入;同一個遊戲兩列合併本數(備註取最後一個有填的)。
 */
export function requisitionLinesOf(
  values: Record<string, unknown>,
): RequisitionLineValue[] {
  const rows = values[REQUISITION_FIELD_KEYS.lines];
  if (!Array.isArray(rows)) {
    return [];
  }
  const byGame = new Map<string, RequisitionLineValue>();
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const gameId = referenceIdOf(row[REQUISITION_FIELD_KEYS.game]);
    const books = booksOf(row[REQUISITION_FIELD_KEYS.books]);
    if (gameId === null || books === 0) {
      continue;
    }
    const rawNote = row[REQUISITION_FIELD_KEYS.lineNote];
    const note =
      typeof rawNote === "string" && rawNote.trim() !== ""
        ? rawNote.trim()
        : null;
    const existing = byGame.get(gameId);
    byGame.set(gameId, {
      gameId,
      books: (existing?.books ?? 0) + books,
      note: note ?? existing?.note ?? null,
    });
  }
  return [...byGame.values()];
}
