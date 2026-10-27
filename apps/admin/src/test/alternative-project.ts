/* eslint-disable sonarjs/no-internal-api-use -- 本檔在 `alt-project` 測試裡頂替 `@repo/project-config/public`(jest moduleNameMapper),寫套件名會對回自己,只能指到 dist;套件改以別的出口提供鍵生成時移除 */
import type { ProjectPublicConfig } from "../../node_modules/@repo/project-config/dist/es/public.js";

// 鍵生成沿用套件的正式實作,只換專案值
export { createAdminStorageKeys } from "../../node_modules/@repo/project-config/dist/es/public.js";

/**
 * 替代專案設定(`*.alt-project.test.*` 專用):每個值都與本專案不同,
 * 新專案的形狀 —— 沒有側欄舊鍵(`legacySideNavStorageKey: null`)。
 * title 刻意帶 HTML 特殊字元,順便驗寫進 HTML 時有跳脫。
 */
export const projectPublic = {
  slug: "acme-portal",
  brand: { name: "Acme Portal", primary: "#2065D1" },
  admin: {
    documentTitle: "Acme <Admin> & Co",
    webApp: {
      name: "Acme <Portal> & Co",
      shortName: "Acme",
      themeColor: "#0B3D91",
      backgroundColor: "#F4F6F8",
    },
  },
  front: {
    metadata: {
      "zh-TW": {
        title: "Acme — 入口",
        titleTemplate: "%s | Acme",
        description: "Acme 的網站",
      },
      en: {
        title: "Acme — Portal",
        titleTemplate: "%s | Acme",
        description: "The Acme site",
      },
    },
  },
  compatibility: { legacySideNavStorageKey: null },
} satisfies ProjectPublicConfig;
