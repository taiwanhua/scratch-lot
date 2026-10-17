/**
 * 發布 workflow 的 manifest 更新(上傳前在 runner 上跑;本身不碰雲端):
 *
 *   pnpm --filter @repo/print-agent exec tsx scripts/update-manifest.ts \
 *     --version 1.0.0 --artifacts <四個壓縮檔所在目錄> --out <新 manifest.json> --removed <要刪的物件清單> \
 *     [--current <目前的 manifest.json;第一次發布不給>]
 *
 * SHA-256 與大小以 runner 上實際要上傳的檔案重算(不信任建置 job 的輸出);
 * `--removed` 每行一個物件路徑(`print-agent/<舊版本>/<檔名>`),上傳完新 manifest 後由 workflow 刪掉。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  PRINT_AGENT_PLATFORMS,
  type PrintAgentReleaseFile,
} from "@repo/domain/printing";

import { addRelease, archiveName, sortFiles } from "../src/release/release";
import { readOptions } from "./lib/bundle";

const options = readOptions(process.argv.slice(2), [
  "--version",
  "--artifacts",
  "--out",
  "--removed",
  "--current",
]);
const required = (name: string): string => {
  const value = options.get(name);
  if (value === undefined) {
    throw new Error(`缺少 ${name}`);
  }
  return value;
};

const version = required("--version");
const artifacts = required("--artifacts");
const files: PrintAgentReleaseFile[] = PRINT_AGENT_PLATFORMS.map((platform) => {
  const name = archiveName(platform);
  const file = path.join(artifacts, name);
  if (!existsSync(file)) {
    throw new Error(`缺少 ${platform} 的壓縮檔:${file}`);
  }
  return {
    platform,
    name,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    size: statSync(file).size,
  };
});

const currentFile = options.get("--current");
const current: unknown =
  currentFile === undefined
    ? null
    : JSON.parse(readFileSync(currentFile, "utf8"));

const { manifest, removedObjects } = addRelease(current, {
  version,
  publishedAt: new Date().toISOString(),
  files: sortFiles(files),
});
writeFileSync(required("--out"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  required("--removed"),
  removedObjects.map((object) => `${object}\n`).join(""),
);
for (const file of files) {
  process.stdout.write(
    `${file.name} ${String(file.size)} sha256=${file.sha256}\n`,
  );
}
process.stdout.write(
  `manifest:latest=${manifest.latest},保留 ${manifest.releases.map((release) => release.version).join(" / ")}\n`,
);
