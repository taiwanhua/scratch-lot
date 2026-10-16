import { type AdminError, parseAdminError } from "@/lib/base/errors";

import type { ModuleManagerErrorCode } from "./module-manager-types";

/**
 * 本頁會收到的業務錯誤碼(GQL-04;正本 `docs/modules/module-manager.md`「api 介面」:
 * 非根組織 → `FORBIDDEN`、id 查無或格式不合法 → `NOT_FOUND`,沒有本模組專屬的新碼)。
 * 認不出來的一律當 `UNEXPECTED`,文案在 `admin.moduleManager.errors.*`。
 */
const MODULE_MANAGER_ERROR_CODES = ["FORBIDDEN", "NOT_FOUND"] as const;

/** 共用形狀(`lib/base/errors.ts`);本頁只看 `code`。 */
export type ModuleManagerError = AdminError<ModuleManagerErrorCode, never>;

export const moduleManagerErrorOf = (error: unknown): ModuleManagerError =>
  parseAdminError(error, { codes: MODULE_MANAGER_ERROR_CODES });
