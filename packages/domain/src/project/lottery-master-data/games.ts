/**
 * 遊戲 `lottery_games` 的欄位規則(專案規格 5.1):api 驗證與 admin 表單共用同一組上下限。
 */

/** 遊戲代號:4 碼數字,租戶內唯一。 */
export const GAME_CODE_PATTERN = /^\d{4}$/;

/** 遊戲名稱長度上限。 */
export const GAME_NAME_MAX_LENGTH = 30;

/** 整本張數的範圍(含兩端)。 */
export const TICKETS_PER_BOOK_MIN = 1;
export const TICKETS_PER_BOOK_MAX = 999;

/** 預設批購金額率(整數 %,含兩端)。 */
export const DEFAULT_RATE_MIN = 0;
export const DEFAULT_RATE_MAX = 100;

/** 備註長度上限(遊戲、收銀點共用)。 */
export const MASTER_DATA_NOTE_MAX_LENGTH = 1000;

/** 遊戲狀態:販售中 / 停售(預設販售中)。 */
export const GAME_STATUSES = ["on_sale", "discontinued"] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const GAME_STATUS = {
  onSale: "on_sale",
  discontinued: "discontinued",
} as const satisfies Record<string, GameStatus>;

export function isGameStatus(value: unknown): value is GameStatus {
  return (
    typeof value === "string" &&
    (GAME_STATUSES as readonly string[]).includes(value)
  );
}

/** 整本金額 = 單張金額 × 整本張數(api 計算後存)。 */
export function bookPriceOf(unitPrice: number, ticketsPerBook: number): number {
  return unitPrice * ticketsPerBook;
}

/** 收銀點名稱長度上限(規格未定,沿用遊戲名稱的 30)。 */
export const CASH_POINT_NAME_MAX_LENGTH = 30;
