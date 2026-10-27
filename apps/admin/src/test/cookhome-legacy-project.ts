/* eslint-disable sonarjs/no-internal-api-use -- 本檔在 `legacy-project` 測試裡頂替 `@repo/project-config/public`(jest moduleNameMapper),寫套件名會對回自己,只能指到 dist;套件改以別的出口提供鍵生成時移除 */
import type { ProjectPublicConfig } from "../../node_modules/@repo/project-config/dist/es/public.js";

// 鍵生成沿用套件的正式實作,只把專案值固定成歷史值
export { createAdminStorageKeys } from "../../node_modules/@repo/project-config/dist/es/public.js";

/**
 * 固定的 CookHome 專案設定(`*.legacy-project.test.*` 專用):抽出專案設定之前散落各處的值。
 * 用它跑的測試守的是「既有瀏覽器裡的鍵、資料格式、側欄舊鍵搬移與原畫面輸出」——
 * 與目前 `packages/project-config/src/project/` 填什麼無關,換專案不必改。
 */
export const projectPublic = {
  slug: "cookhome",
  brand: { name: "CookHome", primary: "#FB7B10" },
  // 抽設定前沒有 manifest(不可安裝)
  admin: { documentTitle: "CookHome 後台管理", webApp: null },
  front: {
    metadata: {
      "zh-TW": {
        title: "CookHome — 家常食譜",
        titleTemplate: "%s | CookHome",
        description: "分享與收藏家常食譜的網站",
      },
      en: {
        title: "CookHome — Home-style Recipes",
        titleTemplate: "%s | CookHome",
        description: "Share and collect home-style recipes",
      },
    },
  },
  compatibility: { legacySideNavStorageKey: "cookhome.admin.sidenav" },
} satisfies ProjectPublicConfig;
