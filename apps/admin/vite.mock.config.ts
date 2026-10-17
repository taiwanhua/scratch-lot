import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

import { colorModeInitTag } from "./src/lib/base/color-mode-init";
import { projectHtmlTransform } from "./src/lib/base/project-html";

/**
 * mock 開發模式的 Vite 設定(`pnpm --filter @repo/admin dev:mock`)。
 *
 * 刻意獨立一支設定檔而不是改 `vite.config.ts`:正式 build 只讀 `vite.config.ts`、
 * 入口只有 `index.html`,所以 `mock.html` / `src/mock/` / `mock-public/` 三者
 * **完全不在正式產物的圖裡**(驗收:`grep -c msw dist/assets/*.js` 為 0)。
 */

/**
 * 假 api 的 GraphQL 端點 — 必須等於 `src/test/msw/server.ts` 的 `TEST_GRAPHQL_ENDPOINT`,
 * 夾具的 handlers 才攔得到。這裡不 import 那支檔案(會把 `msw/node` 拉進 Vite 設定的載入過程),
 * 改成 `src/mock/browser.ts` 開機時比對兩者:漂走時當場炸,而不是靜默打到真 api。
 */
const MOCK_GRAPHQL_ENDPOINT = "https://api.test/graphql";

/**
 * 深層網址(`/system/org-manager`)重新整理時,Vite 的 SPA fallback 會回 `index.html` ——
 * 那是**正式入口**,沒有註冊 worker,畫面會變成打真 api 的空殼。
 * 這個 plugin 把所有 HTML 導覽一律指到 `mock.html`,mock 模式才經得起重新整理與深層連結。
 */
const mockHtmlEntry: Plugin = {
  name: "admin:mock-html-entry",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const accept = request.headers.accept ?? "";
      if (request.method === "GET" && accept.includes("text/html")) {
        request.url = "/mock.html";
      }
      next();
    });
  },
};

/** 首幀外觀腳本注入 `<head>`(見 `src/lib/base/color-mode-init.ts`)。 */
const colorModeInit = {
  name: "admin:color-mode-init",
  transformIndexHtml: () => [colorModeInitTag()],
};

/** `<title>` 寫入專案設定的頁面標題,後面加(mock)(見 `src/lib/base/project-html.ts`)。 */
const projectHtml = {
  name: "admin:project-html",
  transformIndexHtml: projectHtmlTransform("mock"),
};

export default defineConfig({
  plugins: [react(), mockHtmlEntry, projectHtml, colorModeInit],
  resolve: {
    alias: {
      // 夾具鏈的 `src/test/msw/server.ts` 在模組層呼叫 node 版 `setupServer()`,
      // 瀏覽器載不進去(msw 的 exports map 對 `./node` 的 browser 條件是 null)——
      // 換成空殼,理由與安全性見 `src/mock/msw-node-stub.ts`
      "msw/node": fileURLToPath(
        new URL("src/mock/msw-node-stub.ts", import.meta.url),
      ),
      // `@/` = src/(與 vite.config.ts、tsconfig paths、jest moduleNameMapper 同一份約定,GEN-01)
      "@": fileURLToPath(new URL("src", import.meta.url)),
    },
  },
  // `msw init` 產的 worker 只放在這裡;正式 build 用的是 `public/`,所以 dist 不會有它
  publicDir: "mock-public",
  // 與正式 dev server 分開的預打包快取(mock 多了 msw 一包,共用會互相失效)
  cacheDir: "node_modules/.vite-mock",
  define: {
    // 讓 `src/lib/base/graphql.ts` 的 GRAPHQL_ENDPOINT 指向假 api(DATA-05 的環境變數這一層)
    "import.meta.env.VITE_GRAPHQL_ENDPOINT": JSON.stringify(
      MOCK_GRAPHQL_ENDPOINT,
    ),
  },
  clearScreen: false,
  server: { host: "0.0.0.0", port: 3002 },
});
