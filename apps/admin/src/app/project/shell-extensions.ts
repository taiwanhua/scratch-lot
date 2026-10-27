import type { ComponentType } from "react";

import { QuickSaleHost } from "@/pages/project/lottery/store/QuickSaleHost";

/**
 * 專案掛在後台殼上的常駐元件(`docs/concepts/frontend-architecture.md`「殼上的常駐元件」;
 * 與 `app/base/shell-extensions.ts` 由 `app/module-pages.tsx` 合成):登入後一直存在、不屬於任何頁面的東西,
 * 例如 B10 全域掃描的預設處理。只追加自己的登記。
 */
export const projectShellExtensions: readonly ComponentType[] = [
  // 店面管理:沒有頁面宣告掃描用途時刷到刮刮樂 → 快速銷售(規格 6.3)
  QuickSaleHost,
];
