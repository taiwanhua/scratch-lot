import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 組織管理會收到的業務錯誤碼(GQL-04;api 的程式正本 `apps/api/src/orgs/org-error.ts`)。
 * 認不出來的一律當 `UNEXPECTED`,文案在 `admin.orgManager.errors.*`。
 */
export const ORG_MANAGER_ERROR_CODES = [
  "ORG_NOT_DELETABLE",
  "PROVISION_NOT_REVOKABLE",
  "CROSS_TENANT",
  "CYCLIC_MOVE",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "UPLOAD_REJECTED",
  "FORBIDDEN",
] as const;

export type OrgManagerErrorCode =
  (typeof ORG_MANAGER_ERROR_CODES)[number] | "UNEXPECTED";

/**
 * `ORG_NOT_DELETABLE` 與 `PROVISION_NOT_REVOKABLE` 共用的前置檢查項
 * (`extensions.reasons`,逐項顯示成清單)—— api 那邊也是同一組語彙、同一支檢查函式
 * (`apps/api/src/orgs/org-error.ts`)。
 */
export const ORG_NOT_DELETABLE_REASONS = [
  "HAS_CHILDREN",
  "HAS_MEMBERS",
  "OWNS_ROLES",
  "HAS_BUSINESS_DATA",
  "SYSTEM_ORG",
] as const;

export type OrgNotDeletableReason = (typeof ORG_NOT_DELETABLE_REASONS)[number];

/**
 * 共用形狀(`lib/base/errors.ts`)。本頁用到的選填欄位:`reasons`(`ORG_NOT_DELETABLE` /
 * `PROVISION_NOT_REVOKABLE` 時逐項列出為什麼不行)與 `fields`(`VALIDATION_FAILED` 時不合法的欄位)。
 */
export type OrgManagerError = AdminError<
  OrgManagerErrorCode,
  OrgNotDeletableReason
>;

export const orgManagerErrorOf = (error: unknown): OrgManagerError =>
  parseAdminError(error, {
    codes: ORG_MANAGER_ERROR_CODES,
    reasons: ORG_NOT_DELETABLE_REASONS,
  });
