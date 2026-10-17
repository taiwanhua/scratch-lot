import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 角色管理會收到的業務錯誤碼(GQL-04;api 的程式正本 `apps/api/src/roles/`)。
 * 認不出來的一律當 `UNEXPECTED`,文案在 `admin.roleManager.errors.*`。
 */
export const ROLE_MANAGER_ERROR_CODES = [
  "ROLE_NOT_DELETABLE",
  "ROLE_OUT_OF_REACH",
  "USER_NOT_ELIGIBLE",
  "OWNER_PROTECTED",
  "NOT_FOUND",
  "FORBIDDEN",
  "VALIDATION_FAILED",
] as const;

export type RoleManagerErrorCode =
  (typeof ROLE_MANAGER_ERROR_CODES)[number] | "UNEXPECTED";

/**
 * `ROLE_NOT_DELETABLE` 的三個前置檢查(`extensions.reasons`,逐項顯示成清單;
 * 正本 `docs/modules/role-manager.md`「api 介面」與 `roles.graphql` 的註解)。
 */
export const ROLE_NOT_DELETABLE_REASONS = [
  "HAS_GRANTS",
  "SYSTEM_ROLE",
  "TEMPLATE_COPY",
] as const;

export type RoleNotDeletableReason =
  (typeof ROLE_NOT_DELETABLE_REASONS)[number];

/**
 * 共用形狀(`lib/base/errors.ts`)。本頁用到的選填欄位:`reasons`(`ROLE_NOT_DELETABLE`
 * 時逐項列出為什麼不能刪)與 `fields`(`VALIDATION_FAILED` 時不合法的欄位)。
 */
export type RoleManagerError = AdminError<
  RoleManagerErrorCode,
  RoleNotDeletableReason
>;

export const roleManagerErrorOf = (error: unknown): RoleManagerError =>
  parseAdminError(error, {
    codes: ROLE_MANAGER_ERROR_CODES,
    reasons: ROLE_NOT_DELETABLE_REASONS,
  });
