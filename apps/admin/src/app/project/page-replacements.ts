import { FieldManagerWithColorPage } from "@/pages/project/system/FieldManagerWithColorPage/FieldManagerWithColorPage";

import type { ModulePageReplacement } from "../module-page-registry";

/**
 * 專案對底座頁的替換:`{ target: <底座模組 key>, Page: <pages/project/ 的客製頁> }`。
 *
 * - `target` 只能是已登記的底座頁,一頁只能替換一次;`minWidth` 省略 = 沿用底座那一頁的寬度
 * - 同一個網址、同一套授權開出客製版;底座的原檔與登記都留著,刪掉這裡的那一筆就回到原版
 */
export const projectPageReplacements: readonly ModulePageReplacement[] = [
  // 欄位管理的選項多一欄「顏色」(標籤色票,規格 18.5);升格後底座頁直接有這一欄,拆掉這筆
  { target: "system.field-manager", Page: FieldManagerWithColorPage },
];
