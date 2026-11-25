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
  | "OPENING_STATE_MISMATCH"
  | "UNEXPECTED";

export type LotterySettingsError = AdminError<LotterySettingsErrorCode, never>;

const CODES = ["FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED"] as const;

/** 期初建檔結束 / 重新開放時已經是那個狀態(別人剛按;`CONFLICT` + reason) */
const OPENING_STATE_MISMATCH = "STORE_OPENING_STATE_MISMATCH";

const REASON_CODES: readonly LotterySettingsErrorCode[] = [
  "COUNT_MODE_CHANGE_BLOCKED",
  "NOT_CONVERTING",
  "NOT_STORE",
  "CONCURRENT_EDIT",
];

type RefinedCode = Exclude<LotterySettingsErrorCode, "UNEXPECTED">;

const refineOf = (code: string, reason: unknown): RefinedCode | undefined => {
  if (code === "CONFLICT" && reason === OPENING_STATE_MISMATCH) {
    return "OPENING_STATE_MISMATCH";
  }
  return code === "VALIDATION_FAILED" &&
    typeof reason === "string" &&
    (REASON_CODES as readonly string[]).includes(reason)
    ? (reason as RefinedCode)
    : undefined;
};

export const lotterySettingsErrorOf = (error: unknown): LotterySettingsError =>
  parseAdminError<RefinedCode, never>(error, {
    codes: CODES,
    refine: refineOf,
  });
