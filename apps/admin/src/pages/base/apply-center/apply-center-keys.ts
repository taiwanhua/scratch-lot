/**
 * 申請中心的模組 key(seed 正本 `apps/db-migrator/seeds/base/modules/apply-center.ts`;admin 不能 import
 * db-migrator,STRUCT-01)。權限只有 `view`;隱藏頁 `view-page` 是詳情頁的路由節點兼權限容器 ——
 * 網址 `/apply-center/view-page/<實例 id>` 與通知信的連結同一個形狀(docs/modules/workflows.md「通知信」)。
 */
export const APPLY_CENTER_MODULE_KEY = "apply-center";

export const APPLY_CENTER_VIEW_PAGE_KEY = `${APPLY_CENTER_MODULE_KEY}.view-page`;

/** 表單模組的新增頁 / 編輯頁節點(表單引擎的四頁形狀)。 */
export const formModulePageKey = (
  moduleKey: string,
  page: "create-page" | "edit-page" | "view-page",
): string => `${moduleKey}.${page}`;
