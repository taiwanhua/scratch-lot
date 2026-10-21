import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 帳戶管理會收到的業務錯誤(GQL-04;正本 `docs/modules/project/accounts.md`「錯誤碼」)。
 * `VALIDATION_FAILED` 依 `extensions.reason` 再細分;文案在 `admin.lotteryAccounts.errors.<code>`。
 */
export type AccountsErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "BANK_ACCOUNT_DUPLICATE"
  | "BANK_ACCOUNT_HAS_TRANSACTIONS"
  | "BANK_ACCOUNT_INACTIVE"
  | "ALREADY_REVERSED"
  | "SETTLEMENT_UNKNOWN"
  | "SETTLEMENT_NOTHING_DUE"
  | "BANK_ACCOUNT_NOT_USABLE"
  | "NO_OPEN_SHIFT"
  | "CASH_POINT_NOT_AT_BRANCH"
  | "PERIOD_CLOSE_INVALID"
  | "PERIOD_NOT_ENDED"
  | "PERIOD_ALREADY_CLOSED"
  | "PERIOD_OUT_OF_ORDER"
  | "PERIOD_SHIFTS_NOT_CLOSED"
  | "PERIOD_PENDING_DOCUMENTS"
  | "UNEXPECTED";

export type AccountsError = AdminError<AccountsErrorCode, never>;

const CODES = ["FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED"] as const;

const REASON_CODES: readonly AccountsErrorCode[] = [
  "BANK_ACCOUNT_DUPLICATE",
  "BANK_ACCOUNT_HAS_TRANSACTIONS",
  "BANK_ACCOUNT_INACTIVE",
  "ALREADY_REVERSED",
  "SETTLEMENT_UNKNOWN",
  "SETTLEMENT_NOTHING_DUE",
  "BANK_ACCOUNT_NOT_USABLE",
  "NO_OPEN_SHIFT",
  "CASH_POINT_NOT_AT_BRANCH",
  // 關帳(規格 10.4)
  "PERIOD_CLOSE_INVALID",
  "PERIOD_NOT_ENDED",
  "PERIOD_ALREADY_CLOSED",
  "PERIOD_OUT_OF_ORDER",
  "PERIOD_SHIFTS_NOT_CLOSED",
  "PERIOD_PENDING_DOCUMENTS",
];

export const accountsErrorOf = (error: unknown): AccountsError =>
  parseAdminError<Exclude<AccountsErrorCode, "UNEXPECTED">, never>(error, {
    codes: CODES,
    refine: (code, reason) =>
      code === "VALIDATION_FAILED" &&
      typeof reason === "string" &&
      (REASON_CODES as readonly string[]).includes(reason)
        ? (reason as Exclude<AccountsErrorCode, "UNEXPECTED">)
        : undefined,
  });
