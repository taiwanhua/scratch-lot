import type { FormPageSlot, UrlStateInventory } from "../module-page-registry";

/**
 * 底座頁面的網址狀態盤點(REACT-14;各頁不放網址的內容與理由見
 * `docs/concepts/frontend-architecture.md`「既有頁面改用的盤點」)。
 * 底座新增頁面時在這裡登記;專案的頁面登記在 `app/project/url-state-inventory.ts`。
 */

/** `baseModulePages.pages` 的每一個固定頁。 */
export const baseUrlStateInventory: UrlStateInventory = {
  overview: [],
  "demo.sub.sample-one": ["list"],
  "demo.sub.sample-one.view-page": [],
  "demo.sub.sample-one.create-page": [],
  "demo.sub.sample-one.edit-page": [],
  "demo.sample-two": ["list"],
  "demo.sample-two.view-page": [],
  "demo.sample-two.create-page": [],
  "demo.sample-two.edit-page": [],
  "system.org-manager": ["detail", "tab", "members", "edit"],
  "system.module-manager": ["detail", "dialog"],
  "system.field-manager": ["detail", "edit"],
  "system.user-manager": ["list", "edit"],
  "system.role-manager": ["list", "detail", "tab", "users", "edit"],
  "system.data-scope": ["detail"],
  "system.forms": ["list", "detail", "edit"],
  "system.workflows": ["list", "detail", "edit"],
  "system.workflows.blocked-page": ["list"],
  "system.notification-settings": ["list", "edit", "badge"],
  "apply-center": ["tab", "list"],
  "apply-center.view-page": [],
  "system.printers": ["tab", "list", "edit"],
};

/**
 * 表單模組的預設組裝(每個表單模組各四頁;底座、專案的表單模組都適用):哪一頁 → 放進網址的 key。
 * 單頁客製(`pageOverrides`)換掉的頁面要另外登記在該來源的盤點表。
 */
export const formModuleUrlStateInventory: Readonly<
  Record<FormPageSlot, readonly string[]>
> = {
  list: ["list"],
  viewPage: ["dialog", "revision"],
  createPage: [],
  editPage: [],
};

/** `app/routes.tsx` 的非模組路由(以路徑登記):登入三頁讀網址參數,個人設定的分頁用 PageTabs、代理人清單的頁碼在 `list`。 */
export const nonModuleRouteUrlStateInventory: UrlStateInventory = {
  "/login": ["next"],
  "/forgot-password": [],
  "/set-password": ["token"],
  "/change-password": ["next"],
  "/settings/personal": ["tab", "list"],
};
