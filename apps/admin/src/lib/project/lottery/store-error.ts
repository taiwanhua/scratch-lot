import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 店面管理會收到的業務錯誤(GQL-04;正本 `docs/modules/project/store.md`「錯誤碼」)。
 * `VALIDATION_FAILED` 依 `extensions.reason` 再細分;文案在 `admin.lotteryStore.errors.<code>`。
 */
export type StoreErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "SHIFT_ALREADY_OPEN"
  | "SHIFT_IN_OTHER_STORE"
  | "SHIFT_CLOSED"
  | "CASH_POINT_DISABLED"
  | "ENTRY_NOT_AVAILABLE"
  | "OPENING_FLOAT_NOT_ALLOWED"
  | "AMOUNT_EXCEEDS_DRAWER"
  | "AMOUNT_EXCEEDS_VAULT"
  | "BANK_DEPOSIT_NO_ACCOUNT"
  | "BANK_ACCOUNT_NOT_USABLE"
  | "PERIOD_CLOSED"
  | "UNEXPECTED";

export type StoreError = AdminError<StoreErrorCode, never>;

const CODES = ["FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED"] as const;

const REASON_CODES: readonly StoreErrorCode[] = [
  "SHIFT_ALREADY_OPEN",
  "SHIFT_IN_OTHER_STORE",
  "SHIFT_CLOSED",
  "CASH_POINT_DISABLED",
  "ENTRY_NOT_AVAILABLE",
  "OPENING_FLOAT_NOT_ALLOWED",
  "AMOUNT_EXCEEDS_DRAWER",
  "AMOUNT_EXCEEDS_VAULT",
  // 存銀行(規格 6.11):本店沒有銀行帳戶 / 帳戶不能用
  "BANK_DEPOSIT_NO_ACCOUNT",
  "BANK_ACCOUNT_NOT_USABLE",
  // 開班 / 改對應排班選到已關帳月份的排班(規格 6.6、10.4)
  "PERIOD_CLOSED",
];

export const storeErrorOf = (error: unknown): StoreError =>
  parseAdminError<Exclude<StoreErrorCode, "UNEXPECTED">, never>(error, {
    codes: CODES,
    refine: (code, reason) =>
      code === "VALIDATION_FAILED" &&
      typeof reason === "string" &&
      (REASON_CODES as readonly string[]).includes(reason)
        ? (reason as Exclude<StoreErrorCode, "UNEXPECTED">)
        : undefined,
  });

/** 錯誤的文案 key(`admin.lotteryStore` 底下)。 */
export const storeErrorKey = (error: unknown): string =>
  `errors.${storeErrorOf(error).code}`;
