/**
 * 遊戲 `lottery_games` 的欄位規則(專案規格 5.1):api 驗證與 admin 表單共用同一組上下限。
 */
import {
  type LocalDate,
  addLocalMonths,
  clampedDateOfMonth,
} from "../../form/temporal";

/** 遊戲代號:4 碼數字,租戶內唯一。 */
export const GAME_CODE_PATTERN = /^\d{4}$/;

/** 遊戲名稱長度上限。 */
export const GAME_NAME_MAX_LENGTH = 30;

/**
 * 單張金額一定是這個數的倍數(使用者 10/28 定案):批購金額率是整數 %,所以單張成本(單張金額 × 批購金額率)
 * 一定是整數元,點收、調貨的成本不會有零頭。
 */
export const UNIT_PRICE_STEP = 100;

/** 單張金額:正整數、而且是 `UNIT_PRICE_STEP` 的倍數(api 驗證與 admin 表單共用)。 */
export function isValidUnitPrice(value: number): boolean {
  return (
    Number.isSafeInteger(value) && value > 0 && value % UNIT_PRICE_STEP === 0
  );
}

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

/** 停售日 = 兌獎截止日往前幾個月。 */
export const DISCONTINUED_MONTHS_BEFORE_CLAIM_DEADLINE = 3;

/** 上市日 = 兌獎截止日往前幾個月。 */
export const LAUNCHED_MONTHS_BEFORE_CLAIM_DEADLINE = 9;

/** 由兌獎截止日推算的兩個日期(租戶時區的日曆日)。 */
export interface GameDerivedDates {
  launchedAt: LocalDate;
  discontinuedAt: LocalDate;
}

function monthsBefore(date: LocalDate, months: number): LocalDate {
  return clampedDateOfMonth(addLocalMonths(date, -months), date.day);
}

/**
 * 上市日、停售日由兌獎截止日推算(api 存檔時算並存;admin 表單即時預覽,同一份):
 * 停售日 = 兌獎截止日 − 3 個月、上市日 = 兌獎截止日 − 9 個月;目標月份沒有那一天 → 取該月最後一天
 * (5/31 − 3 個月 = 2/28,閏年 2/29)。以租戶時區的日曆日計算,換時點由呼叫端做。
 */
export function gameDatesOf(claimDeadline: LocalDate): GameDerivedDates {
  return {
    launchedAt: monthsBefore(
      claimDeadline,
      LAUNCHED_MONTHS_BEFORE_CLAIM_DEADLINE,
    ),
    discontinuedAt: monthsBefore(
      claimDeadline,
      DISCONTINUED_MONTHS_BEFORE_CLAIM_DEADLINE,
    ),
  };
}

/** 收銀點名稱長度上限(規格未定,沿用遊戲名稱的 30)。 */
export const CASH_POINT_NAME_MAX_LENGTH = 30;
