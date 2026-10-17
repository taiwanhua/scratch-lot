import {
  RULE_INVALID_REASONS,
  type RuleInvalidReason,
} from "@/lib/base/data-scope-issues";
import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 資料範圍會收到的業務錯誤碼(GQL-04;api 的程式正本 `apps/api/src/data-scope/data-scope-error.ts`)。
 * 認不出來的一律當 `UNEXPECTED`,文案在 `admin.dataScope.errors.*`。
 */
export const DATA_SCOPE_ERROR_CODES = [
  "RULE_INVALID",
  "NOT_FOUND",
  "FORBIDDEN",
] as const;

export type DataScopeErrorCode =
  (typeof DATA_SCOPE_ERROR_CODES)[number] | "UNEXPECTED";

/**
 * 共用形狀(`lib/base/errors.ts`)。本頁用到的選填欄位只在 `RULE_INVALID` 才有:
 * `path` 指到條件樹裡出問題的位置(`rules[0].filter.children[1].value`)、
 * `reason` 是原因列舉(前端依它顯示中文)。
 */
export type DataScopeError = AdminError<DataScopeErrorCode, RuleInvalidReason>;

export const dataScopeErrorOf = (error: unknown): DataScopeError =>
  parseAdminError(error, {
    codes: DATA_SCOPE_ERROR_CODES,
    reasons: RULE_INVALID_REASONS,
  });
