import { ClientError } from "@repo/graphql";

import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 經銷商管理會收到的業務錯誤(GQL-04;api 正本 `apps/api/src/project/lottery/dealers/dealers-error.ts`)。
 * 文案在 `admin.lotteryDealers.errors.*`:有 `reason` 的用 `reasons.<reason>`,其餘用 `<code>`。
 */
export const DEALERS_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
] as const;

export const DEALERS_ERROR_REASONS = [
  "FIELD_FORBIDDEN",
  "LICENSE_NO_DUPLICATE",
  "NATIONAL_ID_DUPLICATE",
  "NOT_FOR_TYPE",
  "RENT_DUE_DAY_REQUIRED",
  "RENT_START_MONTH_REQUIRED",
  "ROLE_LIMIT",
  "TRUSTEE_NOT_ALLOWED",
  "CONTACT_REPEATED",
  "CONTACT_ROLE_MISMATCH",
  "CONTACT_DISABLED",
  "SELF_RELATION",
  "AGENT_REQUIRES_CO_SALES",
  "CO_SALES_NOT_CLASS_B",
  "DEALER_TERMINATED",
  "STORE_OCCUPIED",
  "STORE_NOT_BRANCH",
  "REFERENCE_NOT_FOUND",
  "SIGNIN_DUPLICATE",
  "SIGNIN_QUARTER_NOT_STARTED",
  "AGENTS_REQUIRE_CO_SALES",
  "ROLE_IN_USE",
] as const;

export type DealersErrorCode =
  (typeof DEALERS_ERROR_CODES)[number] | "UNEXPECTED";
export type DealersErrorReason = (typeof DEALERS_ERROR_REASONS)[number];
export type DealersError = AdminError<DealersErrorCode, DealersErrorReason>;

export const dealersErrorOf = (error: unknown): DealersError =>
  parseAdminError(error, {
    codes: DEALERS_ERROR_CODES,
    reasons: DEALERS_ERROR_REASONS,
  });

/** 錯誤的文案 key(`admin.lotteryDealers.errors` 底下;寫成字面值,死鍵掃描才看得到)。 */
const ERROR_TEXT_KEYS: Record<DealersErrorCode | DealersErrorReason, string> = {
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFLICT: "CONFLICT",
  UNEXPECTED: "UNEXPECTED",
  FIELD_FORBIDDEN: "reasons.FIELD_FORBIDDEN",
  LICENSE_NO_DUPLICATE: "reasons.LICENSE_NO_DUPLICATE",
  NATIONAL_ID_DUPLICATE: "reasons.NATIONAL_ID_DUPLICATE",
  NOT_FOR_TYPE: "reasons.NOT_FOR_TYPE",
  RENT_DUE_DAY_REQUIRED: "reasons.RENT_DUE_DAY_REQUIRED",
  RENT_START_MONTH_REQUIRED: "reasons.RENT_START_MONTH_REQUIRED",
  ROLE_LIMIT: "reasons.ROLE_LIMIT",
  TRUSTEE_NOT_ALLOWED: "reasons.TRUSTEE_NOT_ALLOWED",
  CONTACT_REPEATED: "reasons.CONTACT_REPEATED",
  CONTACT_ROLE_MISMATCH: "reasons.CONTACT_ROLE_MISMATCH",
  CONTACT_DISABLED: "reasons.CONTACT_DISABLED",
  SELF_RELATION: "reasons.SELF_RELATION",
  AGENT_REQUIRES_CO_SALES: "reasons.AGENT_REQUIRES_CO_SALES",
  CO_SALES_NOT_CLASS_B: "reasons.CO_SALES_NOT_CLASS_B",
  DEALER_TERMINATED: "reasons.DEALER_TERMINATED",
  STORE_OCCUPIED: "reasons.STORE_OCCUPIED",
  STORE_NOT_BRANCH: "reasons.STORE_NOT_BRANCH",
  REFERENCE_NOT_FOUND: "reasons.REFERENCE_NOT_FOUND",
  SIGNIN_DUPLICATE: "reasons.SIGNIN_DUPLICATE",
  SIGNIN_QUARTER_NOT_STARTED: "reasons.SIGNIN_QUARTER_NOT_STARTED",
  AGENTS_REQUIRE_CO_SALES: "reasons.AGENTS_REQUIRE_CO_SALES",
  ROLE_IN_USE: "reasons.ROLE_IN_USE",
};

/** 有原因用原因的文案,沒有用碼的文案。 */
export const dealersErrorKey = (error: DealersError): string =>
  ERROR_TEXT_KEYS[error.reason ?? error.code];

/** `CONFLICT` 列出的關聯(api `extensions.relationships`)。 */
export interface ConflictRelationship {
  role: "agent" | "trustee" | "introducer";
  dealerId: string;
  dealerName: string;
  licenseNo: string;
  contactId: string;
  contactName: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const conflictExtensionsOf = (
  error: unknown,
): Record<string, unknown> | undefined => {
  if (!(error instanceof ClientError)) {
    return undefined;
  }
  const { errors } = error.response as { errors?: unknown };
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  const extensions = isRecord(first) ? first.extensions : undefined;
  return isRecord(extensions) ? extensions : undefined;
};

export const conflictRelationshipsOf = (
  error: unknown,
): ConflictRelationship[] => {
  const list = conflictExtensionsOf(error)?.relationships;
  return Array.isArray(list)
    ? list.filter((item): item is ConflictRelationship => isRecord(item))
    : [];
};

/**
 * 另有幾筆操作者看不到的經銷商上的關聯(api `extensions.hiddenCount`;資料共用 ADR-0014):
 * 只回筆數,確認後一起解除。沒有 → 0。
 */
export const conflictHiddenCountOf = (error: unknown): number => {
  const count = conflictExtensionsOf(error)?.hiddenCount;
  return typeof count === "number" && count > 0 ? count : 0;
};
