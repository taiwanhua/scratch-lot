#!/usr/bin/env node
/**
 * 由專案的 SVG 圖示正本產生 app 圖示與 favicon(換圖時手動跑一次,產物提交進 repo;build 不跑)。
 *
 *   node scripts/app-icons/generate.mjs apps/admin/public
 *
 * 讀(專案資產,放 `<public>/project/`):
 *   icon.svg           一般圖示:四角可透明,給瀏覽器分頁、桌面捷徑、app 清單
 *   icon-maskable.svg  可遮罩圖示:滿版不透明底色,圖案留在中央 80% 的安全區內;
 *                      Android 依啟動器形狀裁切,iOS 主畫面也用它(iOS 自己裁圓角、不吃透明)
 * 寫:
 *   <public>/project/icon-192.png、icon-512.png、icon-maskable-512.png、apple-touch-icon.png(180)
 *   <public>/favicon.ico(16 / 32 / 48)
 *
 * 檔名是固定約定:admin 的 `src/lib/base/web-app-manifest.ts` 照這組名稱寫 manifest 與 `<head>`;
 * admin build 開始前由 `apps/admin/scripts/web-app-plugin.mjs` 檢查檔案在、是 PNG、尺寸對,不對就 build 失敗。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import sharp from "sharp";

import { packIco } from "./ico.mjs";

const SOURCES = { any: "icon.svg", maskable: "icon-maskable.svg" };

const OUTPUTS = [
  { file: "icon-192.png", source: "any", size: 192 },
  { file: "icon-512.png", source: "any", size: 512 },
  { file: "icon-maskable-512.png", source: "maskable", size: 512 },
  { file: "apple-touch-icon.png", source: "maskable", size: 180 },
];

const FAVICON_SIZES = [16, 32, 48];

/** 以足夠的密度把 SVG 點陣化再縮到目標尺寸,小尺寸邊緣才不糊。 */
const render = (svg, size) =>
  sharp(svg, { density: Math.max(72, Math.ceil((72 * size * 4) / 512)) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

const publicDir = process.argv[2];
if (!publicDir) {
  process.stderr.write(
    "用法:node scripts/app-icons/generate.mjs <app 的 public 目錄>\n",
  );
  process.exit(1);
}

const root = resolve(publicDir);
const projectDir = join(root, "project");
const svgs = Object.fromEntries(
  Object.entries(SOURCES).map(([key, file]) => [
    key,
    readFileSync(join(projectDir, file)),
  ]),
);

for (const { file, source, size } of OUTPUTS) {
  writeFileSync(join(projectDir, file), await render(svgs[source], size));
  process.stdout.write(`寫入 ${join(projectDir, file)}\n`);
}

const favicon = packIco(
  await Promise.all(
    FAVICON_SIZES.map(async (size) => ({
      size,
      png: await render(svgs.any, size),
    })),
  ),
);
writeFileSync(join(root, "favicon.ico"), favicon);
process.stdout.write(`寫入 ${join(root, "favicon.ico")}\n`);
