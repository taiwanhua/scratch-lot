import type { ComponentType } from "react";

/**
 * 底座掛在後台殼上的常駐元件(`docs/concepts/frontend-architecture.md`「殼上的常駐元件」);目前底座沒有。
 * 專案的登記在 `app/project/shell-extensions.ts`,兩份由 `app/module-pages.tsx` 合成。
 */
export const baseShellExtensions: readonly ComponentType[] = [];
