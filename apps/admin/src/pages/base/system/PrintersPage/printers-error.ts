import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 印表機管理會收到的業務錯誤碼(GQL-04;api 的程式正本 `apps/api/src/printing/printing-error.ts`)。
 * 認不出來的一律當 `UNEXPECTED`,文案在 `admin.printers.errors.*`。
 * `CONFLICT` 只有一種:重新配對已停用的代理程式(`reason AGENT_DISABLED`)。
 */
export const PRINTERS_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
] as const;

export type PrintersErrorCode =
  (typeof PRINTERS_ERROR_CODES)[number] | "UNEXPECTED";

/** 共用形狀(`lib/base/errors.ts`);`VALIDATION_FAILED` 時 `fields` 指到出錯的欄位。 */
export type PrintersError = AdminError<PrintersErrorCode, never>;

export const printersErrorOf = (error: unknown): PrintersError =>
  parseAdminError(error, { codes: PRINTERS_ERROR_CODES });
