import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 使用者管理會收到的業務錯誤碼(GQL-04;api 的程式正本 `apps/api/src/users/users-error.ts`)。
 * 認不出來的一律當 `UNEXPECTED`,文案在 `admin.userManager.errors.*`。
 */
export const USER_MANAGER_ERROR_CODES = [
  "OWNER_PROTECTED",
  "LAST_ORG",
  "ROLE_OUT_OF_REACH",
  /** #261:使用者不在角色擁有組織的子樹內(在此之前回 VALIDATION_FAILED,只講得出「資料未通過驗證」) */
  "USER_NOT_ELIGIBLE",
  /** 停用的角色不可新授予(指派角色、複製組織與角色) */
  "ROLE_DISABLED",
  "FORBIDDEN",
  "VALIDATION_FAILED",
] as const;

export type UserManagerErrorCode =
  (typeof USER_MANAGER_ERROR_CODES)[number] | "UNEXPECTED";

/**
 * 共用形狀(`lib/base/errors.ts`)。本頁用到的選填欄位只有 `fields`:
 * `VALIDATION_FAILED` 時 api 以 `extensions.fields` 指出重複 / 不合法的欄位。
 */
export type UserManagerError = AdminError<UserManagerErrorCode, never>;

export const userManagerErrorOf = (error: unknown): UserManagerError =>
  parseAdminError(error, { codes: USER_MANAGER_ERROR_CODES });
