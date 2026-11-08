import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 刮刮樂設定會收到的業務錯誤(GQL-04;正本 `docs/modules/project/lottery-settings.md`「錯誤碼」)。
 * `VALIDATION_FAILED` 依 `extensions.reason` 再細分成本頁的碼;文案在 `admin.lotterySettings.errors.<code>`。
 */
export type LotterySettingsErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "COUNT_MODE_CHANGE_BLOCKED"
  | "NOT_CONVERTING"
  | "NOT_STORE"
  | "CONCURRENT_EDIT"
  | "UNEXPECTED";

export type LotterySettingsError = AdminError<LotterySettingsErrorCode, never>;

const CODES = ["FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED"] as const;

const REASON_CODES: readonly LotterySettingsErrorCode[] = [
  "COUNT_MODE_CHANGE_BLOCKED",
  "NOT_CONVERTING",
  "NOT_STORE",
  "CONCURRENT_EDIT",
];

export const lotterySettingsErrorOf = (error: unknown): LotterySettingsError =>
  parseAdminError<Exclude<LotterySettingsErrorCode, "UNEXPECTED">, never>(
    error,
    {
      codes: CODES,
      refine: (code, reason) =>
        code === "VALIDATION_FAILED" &&
        typeof reason === "string" &&
        (REASON_CODES as readonly string[]).includes(reason)
          ? (reason as Exclude<LotterySettingsErrorCode, "UNEXPECTED">)
          : undefined,
    },
  );
