import { GraphQLError } from "graphql";

/**
 * 列印的業務錯誤(GQL-04;docs/modules/printers.md「錯誤」)。不新增 code:
 * 只用 `NOT_FOUND` / `VALIDATION_FAILED` / `CONFLICT`(+ `reason`);`FORBIDDEN` 由權限守門或
 * `authError("FORBIDDEN")` 丟。代理程式的 HTTP 端點不走 GraphQL,錯誤見 `print-agent.controller.ts`。
 */

/** `CONFLICT` 的 `reason`(列舉正本;前端認不得時退回 `CONFLICT` 的通用文案)。 */
export const PRINTING_CONFLICT_REASONS = [
  // 已停用的代理程式不能重新配對(停用是終態;要再用請新增代理程式並把印表機改掛過去)
  "AGENT_DISABLED",
] as const;
export type PrintingConflictReason = (typeof PRINTING_CONFLICT_REASONS)[number];

/** `VALIDATION_FAILED` 的 `fieldErrors[].code`。 */
export const PRINTING_FIELD_ERROR_CODES = [
  "REQUIRED",
  "INVALID",
  // 印表機停用、或它的代理程式已停用 → 列印按鈕上不可選
  "PRINTER_UNAVAILABLE",
  // 不是 PNG、寬度不是該紙寬的點數、或超過大小上限
  "INVALID_IMAGE",
] as const;
export type PrintingFieldErrorCode =
  (typeof PRINTING_FIELD_ERROR_CODES)[number];

export interface PrintingFieldError {
  fieldKey: string;
  code: PrintingFieldErrorCode;
  message: string;
}

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 輸入不合法:`fields`(欄位名)+ `fieldErrors`(同表單的形狀 `{ fieldKey, code, message }`)。 */
export function validationError(
  errors: readonly PrintingFieldError[],
): GraphQLError {
  const summary = errors
    .map((error) => `${error.fieldKey}(${error.code})`)
    .join(", ");
  return new GraphQLError(`Invalid print input: ${summary}`, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields: errors.map((error) => error.fieldKey),
      fieldErrors: errors,
    },
  });
}

/** 單一欄位的 `VALIDATION_FAILED`。 */
export function fieldError(
  fieldKey: string,
  code: PrintingFieldErrorCode,
  message: string,
): GraphQLError {
  return validationError([{ fieldKey, code, message }]);
}

export function conflictError(
  message: string,
  reason: PrintingConflictReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "CONFLICT", reason },
  });
}
