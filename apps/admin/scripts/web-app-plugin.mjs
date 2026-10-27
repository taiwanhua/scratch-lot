import { readFileSync } from "node:fs";
import path from "node:path";

import {
  WEB_APP_ICONS,
  WEB_APP_MANIFEST_PATH,
  webAppHeadTags,
  webAppManifestSource,
} from "../src/lib/base/web-app-manifest.ts";

/**
 * 可安裝 app 的 Vite 外掛(只接正式入口 `vite.config.ts`;mock 入口不接,不可安裝)。
 * manifest 內容與 `<head>` 標籤在 `src/lib/base/web-app-manifest.ts`;這裡是 build 端:
 * 輸出 `manifest.webmanifest`、dev server 回同一份、build 開始前檢查圖示。
 * 放在 scripts/(node 端)而不是 src/:要讀檔,而 src/ 是瀏覽器層。
 */

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** 簽章 8 + IHDR 長度 4 + 類型 4 + 寬 4 + 高 4 */
const PNG_HEADER_BYTES = 24;

/**
 * PNG 的寬高;不是 PNG(太短、簽章不對、第一個 chunk 不是 IHDR)回 null。
 * 先驗長度與簽章再讀寬高,壞檔不會丟出 RangeError。
 */
export const pngSizeOf = (buffer) => {
  if (
    buffer.length < PNG_HEADER_BYTES ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

/**
 * 檢查圖示(相對 public 目錄的網址路徑與應有的邊長):回傳問題清單,空陣列 = 全部正常。
 * 每個問題指出檔案與原因(不存在 / 不是 PNG / 尺寸不對)。
 */
export const webAppIconProblems = (publicDir, icons = WEB_APP_ICONS) =>
  Object.values(icons).flatMap(({ src, size }) => {
    const file = path.join(publicDir, src);
    let buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      return [`圖示不存在:${file}`];
    }
    const actual = pngSizeOf(buffer);
    if (actual === null) {
      return [`圖示不是 PNG:${file}`];
    }
    if (actual.width !== size || actual.height !== size) {
      return [
        `圖示尺寸不對:${file} 是 ${actual.width}×${actual.height},應為 ${size}×${size}`,
      ];
    }
    return [];
  });

/**
 * 外掛本體。`webApp` 為 null(專案不提供 manifest)時什麼都不做:不加標籤、不輸出 manifest、不檢查圖示。
 * 圖示有問題時 build 失敗(由 `scripts/app-icons/generate.mjs` 從 SVG 正本產生)。
 */
export const webAppManifestPlugin = (webApp) => {
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
      const problems = webAppIconProblems(publicDir);
      if (problems.length > 0) {
        throw new Error(
          `可安裝 app 的圖示有問題(跑 scripts/app-icons/generate.mjs 重新產生):\n${problems.join("\n")}`,
        );
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
        this.emitFile({
          type: "asset",
          fileName: manifestFile,
          source: webAppManifestSource(webApp),
        });
      }
    },
  };
};
