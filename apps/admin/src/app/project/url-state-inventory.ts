import type { UrlStateInventory } from "../module-page-registry";

/**
 * 專案頁面的網址狀態盤點(REACT-14 入口清單;底座的在 `app/base/url-state-inventory.ts`,不必動)。
 * 登記 `module-pages.ts` 的每一個固定頁、每個表單模組客製過的頁,以及 `page-replacements.ts` 換掉的底座頁
 * (換掉之後的頁放進網址的 key 以這裡為準):頁面 key → 這一頁以 `useUrlState` 放進網址的 key。
 */
export const projectUrlStateInventory: UrlStateInventory = {};
