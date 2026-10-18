#!/usr/bin/env node
/**
 * 防回歸檢查:確認每份模組說明的內容真的被打包進 `dist/assets/*.js`。
 * 說明有三份來源(`scripts/help-sources.mjs` 的 `HELP_SOURCES`):底座、專案新增、專案替換;
 * 專案的兩個目錄可以是空的。
 *
 * 為什麼需要它:根目錄 `.dockerignore` 有 `**\/*.md`,曾把整個 `src/md/` 排除在
 * Docker build context 之外 —— 本機 `pnpm build` 正常、CI 建出來的 image 卻讓
 * `import.meta.glob(…)` 變成空的,三環境每頁的「?」全部 disabled,而且沒有任何一步會失敗。
 * 所以檢查放在 Dockerfile 的 builder stage(build 之後),用真正的 build context 跑。
 *
 * 會紅的情況:
 *   1. **檔案根本不在 context**(dockerignore 排掉 / 目錄被搬走)→ 底座掃到 0 份就紅。
 *   2. **檔案在、但沒被 glob 收進去**:檔名不合 `<moduleKey>.help.md`,或放在三個來源目錄以外。
 *   3. **登記有碰撞**:專案新增撞底座的 key、替換的對象不是底座的說明(留到瀏覽器載入才丟錯就太晚了)。
 *   4. **內容不在 bundle 裡**(指紋比對,見下)。
 *
 * 另外,表單模組共用的通用說明 `form-module.help.md` 必須存在於底座:表單模組沒有專屬檔時「?」退回它
 * (`lib/base/module-help.ts` 的 `resolveModuleHelp`),它不見了所有表單模組的說明一起消失。
 *
 * 比對方式:每份取第一個 `## ` 標題後的第一個非空行,前 12 個字當指紋。bundle 是
 * 壓縮過的 JS 字串,非 ASCII 可能被輸出成 `\uXXXX`,所以原字串與跳脫形式都試。
 * bundle 裡有那段文字只證明「檔案被收進去」;「?」實際選到哪一份(替換優先於底座)由
 * `HelpButton` 的元件測試驗。
 *
 * 參數(測試用;不給就是正式路徑):`--help-dir=<說明根目錄>`、`--assets-dir=<dist/assets>`。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readHelpSources } from "./help-sources.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FINGERPRINT_LENGTH = 12;

const argOf = (name) => {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit === undefined ? undefined : resolve(hit.slice(prefix.length));
};

const helpDir = argOf("help-dir") ?? join(appRoot, "src", "md", "module-help");
const assetsDir = argOf("assets-dir") ?? join(appRoot, "dist", "assets");

const fail = (message, details = []) => {
  console.error(`check:help-bundle ✗ ${message}`);
  for (const item of details) console.error(`  - ${item}`);
  process.exit(1);
};

const listFiles = (dir, suffix) => {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(suffix))
      .sort();
  } catch {
    return undefined;
  }
};

/** 第一個 `## ` 標題後的第一個非空行的前 12 個字;拿不到就回 undefined。 */
const fingerprintOf = (markdown) => {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.startsWith("## "));
  if (headingIndex === -1) return undefined;
  const body = lines.slice(headingIndex + 1).find((line) => line.trim() !== "");
  return body?.trim().slice(0, FINGERPRINT_LENGTH);
};

/** bundle 可能把非 ASCII 壓成 `\uXXXX`,兩種形式都算命中。 */
const escapeNonAscii = (text) =>
  [...text]
    .map((char) => {
      const code = char.codePointAt(0);
      if (code < 0x80) return char;
      return [...char]
        .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
        .join("");
    })
    .join("");

const { files: helpFiles, problems } = readHelpSources(helpDir);
if (problems.length > 0) {
  fail("模組說明的來源有問題:", problems);
}

const bundles = listFiles(assetsDir, ".js");
if (bundles === undefined || bundles.length === 0) {
  fail(
    `找不到建置產物 ${assetsDir}/*.js —— 請先跑 \`pnpm --filter @repo/admin build\``,
  );
}
const bundleText = bundles
  .filter((name) => name.startsWith("index-"))
  .concat(bundles.filter((name) => !name.startsWith("index-")))
  .map((name) => readFileSync(join(assetsDir, name), "utf8"))
  .join("\n");

const missing = [];
for (const { relativePath, content } of helpFiles) {
  const fingerprint = fingerprintOf(content);
  if (fingerprint === undefined || fingerprint.length === 0) {
    missing.push(`${relativePath}(取不出指紋:缺 \`## \` 標題或其後沒有內容)`);
    continue;
  }
  const hit =
    bundleText.includes(fingerprint) ||
    bundleText.includes(escapeNonAscii(fingerprint));
  if (!hit) {
    missing.push(`${relativePath}(指紋「${fingerprint}」不在 bundle 裡)`);
  }
}

if (missing.length > 0) {
  fail("下列模組說明沒有被打包進 dist:", [
    ...missing,
    "檢查:①根目錄 .dockerignore 是否把 apps/admin/src/md/**/*.md 排除 " +
      "②檔名是否為 <moduleKey>.help.md、是否放在來源目錄裡(lib/base/help-registry.ts 的 glob)",
  ]);
}

const countOf = (source) =>
  helpFiles.filter((file) => file.source === source).length;
console.log(
  `check:help-bundle ✓ ${helpFiles.length} 份模組說明都在 dist/assets 裡` +
    `(底座 ${countOf("base")}、專案新增 ${countOf("additions")}、專案替換 ${countOf("replacements")})`,
);
