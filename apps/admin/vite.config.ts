import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { projectPublic } from "@repo/project-config/public";

import { webAppManifestPlugin } from "./scripts/web-app-plugin.mjs";
import { colorModeInitTag } from "./src/lib/base/color-mode-init";
import { projectHtmlTransform } from "./src/lib/base/project-html";

/** 首幀外觀腳本注入 `<head>`(見 `src/lib/base/color-mode-init.ts`)。 */
const colorModeInit = {
  name: "admin:color-mode-init",
  transformIndexHtml: () => [colorModeInitTag()],
};

/** `<title>` 寫入專案設定的頁面標題(見 `src/lib/base/project-html.ts`)。 */
const projectHtml = {
  name: "admin:project-html",
  transformIndexHtml: projectHtmlTransform("app"),
};

/**
 * 可安裝成 app(外掛在 `scripts/web-app-plugin.mjs`,內容在 `src/lib/base/web-app-manifest.ts`):
 * 輸出 manifest、`<head>` 加標籤、build 前檢查圖示。值為專案設定 `admin.webApp`(null = 不做)。
 * 只接正式入口;mock 入口(`vite.mock.config.ts`)不接,不可安裝。
 */
const webAppManifest = webAppManifestPlugin(projectPublic.admin.webApp);

export default defineConfig({
  plugins: [react(), projectHtml, colorModeInit, webAppManifest],
  resolve: {
    // `@/` = src/(與 tsconfig paths、jest moduleNameMapper 同一份約定,GEN-01)
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * 把幾乎不隨改版變動的第三方程式碼切出獨立 chunk。兩個目的:
         * ①**快取命中率** —— 這些 chunk 首頁一樣要載(index.html 會一起 modulepreload,
         * 不產生瀑布),但每次部署後回訪的人不必重抓 MUI / React;
         * ②每個 chunk 都壓到 500 kB 以下,vite 的大小提醒才回到「有事才叫」的狀態
         * (所以不用調 `build.chunkSizeWarningLimit` 把提醒關掉)。
         * `@mui/x-*`(tree-view / date-pickers)自己就佔 440 kB,要與 `@mui/material` 分開才過線;
         * 加了日期時間選擇器後 date-pickers 再長一截,與 tree-view 各自一個 chunk。
         * 真正要減少初次載入量的是路由層的 `React.lazy`,那是另一件事。
         * 命名對齊 rolldown 1.2 的新名字 `codeSplitting`(舊名 `advancedChunks` 已 deprecated)。
         */
        codeSplitting: {
          groups: [
            {
              name: "mui-x-date-pickers",
              test: /[\\/]node_modules[\\/]@mui[\\/]x-date-pickers[\\/]/,
            },
            { name: "mui-x", test: /[\\/]node_modules[\\/]@mui[\\/]x-/ },
            {
              name: "mui-icons",
              test: /[\\/]node_modules[\\/]@mui[\\/]icons-/,
            },
            { name: "mui", test: /[\\/]node_modules[\\/](@mui|@emotion)[\\/]/ },
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
