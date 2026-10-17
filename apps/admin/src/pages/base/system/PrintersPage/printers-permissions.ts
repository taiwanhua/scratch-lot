/**
 * 印表機管理的模組 key 與權限 key(正本 `docs/modules/printers.md` 權限表;seed 正本
 * `apps/db-migrator/seeds/base/modules/system.ts` 的 `PRINTERS_KEY`,admin 不能 import db-migrator,STRUCT-01)。
 *
 * - `view`:看三個分頁(印表機、代理程式、列印紀錄)
 * - `create`:新增代理程式、新增印表機、下載區的下載按鈕
 * - `edit`:列上的 [編輯]、[停用]、[重新配對]、[測試列印]
 *
 * 本模組不回 `abilities`:按鈕顯示依 `usePermissions` 判斷。
 */
export const PRINTERS_MODULE_KEY = "system.printers";

export const PRINTERS_PERMISSIONS = {
  view: `${PRINTERS_MODULE_KEY}.view`,
  create: `${PRINTERS_MODULE_KEY}.create`,
  edit: `${PRINTERS_MODULE_KEY}.edit`,
} as const;
