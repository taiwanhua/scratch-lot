import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 代理設定會收到的業務錯誤(GQL-04;api 正本 `apps/api/src/user-delegations/user-delegations-error.ts`)。
 * 認不出來的一律 `UNEXPECTED`;文案在 `admin.personalSettings.delegations.errors.*`。
 */
export const DELEGATIONS_ERROR_CODES = [
  "NOT_FOUND",
  "VALIDATION_FAILED",
] as const;

export const DELEGATIONS_ERROR_REASONS = [
  "DELEGATION_OVERLAP",
  "SELF_DELEGATION",
  "DELEGATE_NOT_ELIGIBLE",
  "INVALID_PERIOD",
  "DELEGATION_ENDED",
] as const;

export type DelegationsErrorReason = (typeof DELEGATIONS_ERROR_REASONS)[number];

export type DelegationsError = AdminError<
  (typeof DELEGATIONS_ERROR_CODES)[number] | "UNEXPECTED",
  DelegationsErrorReason
>;

export const delegationsErrorOf = (error: unknown): DelegationsError =>
  parseAdminError(error, {
    codes: DELEGATIONS_ERROR_CODES,
    reasons: DELEGATIONS_ERROR_REASONS,
  });

/** 文案 key:認得的 reason 用 `reasons.<reason>`,否則 `<code>`。 */
export const delegationsErrorKey = (error: DelegationsError): string =>
  error.reason === undefined ? error.code : `reasons.${error.reason}`;
