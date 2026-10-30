import type { ModulePageReplacement } from "../module-page-registry";

/**
 * 專案對底座頁的替換:`{ target: <底座模組 key>, Page: <pages/project/ 的客製頁> }`。
 *
 * - `target` 只能是已登記的底座頁,一頁只能替換一次;`minWidth` 省略 = 沿用底座那一頁的寬度
 * - 同一個網址、同一套授權開出客製版;底座的原檔與登記都留著,刪掉這裡的那一筆就回到原版
 *
 * 目前沒有替換:全部沿用底座頁。
 */
export const projectPageReplacements: readonly ModulePageReplacement[] = [];
