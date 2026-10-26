import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

import { colorModeInitTag } from "./src/lib/base/color-mode-init";
import { projectHtmlTransform } from "./src/lib/base/project-html";
import {
  WEB_APP_ICONS,
  WEB_APP_MANIFEST_PATH,
  projectWebApp,
  webAppHeadTags,
  webAppManifestSource,
} from "./src/lib/base/web-app-manifest";

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
 * 可安裝成 app(見 `src/lib/base/web-app-manifest.ts`):build 時輸出 `manifest.webmanifest`、
 * `<head>` 加 manifest / theme-color / apple-touch-icon;dev server 也回同一份 manifest。
 * 專案設定 `admin.webApp` 為 null 時整個不做。只接正式入口,mock 入口不可安裝。
 * build 開始前檢查圖示(專案資產,`scripts/app-icons/generate.mjs` 產生)都在且尺寸對,漏了就讓 build 失敗。
 */
const webAppManifest = (): Plugin => {
  const webApp = projectWebApp();
  const manifestFile = WEB_APP_MANIFEST_PATH.slice(1);
  let publicDir = "";
  return {
    name: "admin:web-app-manifest",
    configResolved(config) {
      ({ publicDir } = config);
    },
    buildStart() {
      if (!webApp) {
        return;
      }
      for (const { src, size } of Object.values(WEB_APP_ICONS)) {
        const file = path.join(publicDir, src);
        let png: Buffer;
        try {
          png = readFileSync(file);
        } catch {
          throw new Error(
            `可安裝 app 的圖示不存在:${file}(跑 scripts/app-icons/generate.mjs 產生)`,
          );
        }
        // PNG 的寬高在 IHDR,固定位於第 16–23 位元組
        const width = png.readUInt32BE(16);
        const height = png.readUInt32BE(20);
        if (
          png.subarray(1, 4).toString("ascii") !== "PNG" ||
          width !== size ||
          height !== size
        ) {
          throw new Error(
            `可安裝 app 的圖示不是 ${String(size)}×${String(size)} 的 PNG:${file}`,
          );
        }
      }
    },
    transformIndexHtml: () => (webApp ? webAppHeadTags(webApp) : []),
    configureServer(server) {
      if (!webApp) {
        return;
      }
      server.middlewares.use(WEB_APP_MANIFEST_PATH, (_request, response) => {
        response.setHeader("Content-Type", "application/manifest+json");
        response.end(webAppManifestSource(webApp));
      });
    },
    generateBundle() {
      if (webApp) {
        // eslint-disable-next-line unicorn/no-this-outside-of-class -- Rollup hook 的 this 是外掛上下文,emitFile 只能從它呼叫
        this.emitFile({
          type: "asset",
          fileName: manifestFile,
          source: webAppManifestSource(webApp),
        });
      }
    },
  };
};

export default defineConfig({
  plugins: [react(), projectHtml, colorModeInit, webAppManifest()],
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
