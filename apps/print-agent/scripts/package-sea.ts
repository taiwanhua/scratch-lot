/**
 * 打包本機平台的單一執行檔(Node 內建 SEA)與安裝檔,輸出 `dist/release/<壓縮檔>`:
 *
 *   pnpm --filter @repo/print-agent package --version 1.0.0 [--winsw <WinSW-x64.exe 路徑>]
 *
 * SEA 用「執行這支腳本的 Node 執行檔」當底,所以只能打包本機平台(發布 workflow 在四種 runner 各跑一次)。
 * 步驟(Node 24 文件「Single executable applications」):
 * 1. esbuild 打成一個 CommonJS 檔 → `node --experimental-sea-config` 產生 blob
 * 2. 複製 node 執行檔 → (macOS 先移除簽章)→ postject 注入 blob → (macOS 以 ad-hoc 簽章,arm64 不簽不能執行)
 * 3. 執行一次 `version` 確認產物可跑且版本正確
 * 4. 放進安裝檔(`packaging/<os>/`;Windows 另加 WinSW)→ 壓縮(Windows zip、其他 tar.gz)
 *
 * macOS 不用 Apple 開發者憑證簽章(ad-hoc 不是公證),所以 `install.sh` 要解除隔離標記。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { zipSync } from "fflate";

import { parseAgentVersion } from "@repo/domain/printing";

import {
  archiveName,
  executableName,
  hostPlatform,
  packagingDir,
} from "../src/release/release";
import { appRoot, bundleAgent, readOptions } from "./lib/bundle";

/** postject 預設的 fuse(Node 執行檔裡的固定字串,見 Node SEA 文件)。 */
/** 系統工具一律用絕對路徑(不吃 PATH;GitHub 的 ubuntu / macOS runner 都在 /usr/bin)。 */
const CODESIGN = "/usr/bin/codesign";
const TAR = "/usr/bin/tar";

const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const options = readOptions(process.argv.slice(2), ["--version", "--winsw"]);
const version = options.get("--version") ?? "";
if (parseAgentVersion(version) === null) {
  throw new Error("--version 必須是 x.y.z");
}
const platform = hostPlatform();
if (platform === null) {
  throw new Error(
    `不支援的打包平台:${process.platform}-${process.arch}(只有 windows-x64、linux-x64、linux-arm64、macos-arm64)`,
  );
}
const winsw = options.get("--winsw");
if (platform === "windows-x64" && winsw === undefined) {
  throw new Error("Windows 要用 --winsw 指定 WinSW-x64.exe");
}

const run = (file: string, args: string[]) =>
  execFileSync(file, args, { stdio: "inherit" });

const work = path.join(appRoot, "dist/sea", platform);
const stage = path.join(work, "print-agent");
const releaseDir = path.join(appRoot, "dist/release");
rmSync(work, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

// 1. 單一 CommonJS 檔 → SEA blob
const bundle = path.join(work, "print-agent.cjs");
const blob = path.join(work, "sea-prep.blob");
await bundleAgent({ version, outfile: bundle });
const seaConfig = path.join(work, "sea-config.json");
writeFileSync(
  seaConfig,
  JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
    useCodeCache: true,
  }),
);
run(process.execPath, ["--experimental-sea-config", seaConfig]);

// 2. node 執行檔 + blob
const executable = path.join(stage, executableName(platform));
copyFileSync(process.execPath, executable);
chmodSync(executable, 0o755);
if (platform === "macos-arm64") {
  run(CODESIGN, ["--remove-signature", executable]);
}
const postject = createRequire(import.meta.url).resolve("postject/dist/cli.js");
run(process.execPath, [
  postject,
  executable,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  SEA_FUSE,
  ...(platform === "macos-arm64" ? ["--macho-segment-name", "NODE_SEA"] : []),
]);
if (platform === "macos-arm64") {
  run(CODESIGN, ["--sign", "-", executable]);
}

// 3. 產物可以跑、版本正確
const reported = execFileSync(executable, ["version"], {
  encoding: "utf8",
}).trim();
if (reported !== version) {
  throw new Error(`執行檔回報的版本 ${reported} 與 ${version} 不符`);
}

// 4. 安裝檔 + 壓縮
cpSync(path.join(appRoot, "packaging", packagingDir(platform)), stage, {
  recursive: true,
  // .gitattributes 之類的版控設定不進安裝檔
  filter: (source) => !path.basename(source).startsWith("."),
});
if (winsw !== undefined) {
  copyFileSync(winsw, path.join(stage, "print-agent-service.exe"));
}
writeFileSync(path.join(stage, "VERSION"), `${version}\n`);
const archive = path.join(releaseDir, archiveName(platform));
rmSync(archive, { force: true });
if (platform === "windows-x64") {
  const entries: Record<string, Uint8Array> = {};
  for (const name of readdirSync(stage)) {
    entries[`print-agent/${name}`] = readFileSync(path.join(stage, name));
  }
  writeFileSync(archive, zipSync(entries, { level: 9 }));
} else {
  for (const name of readdirSync(stage)) {
    if (name === executableName(platform) || name.endsWith(".sh")) {
      chmodSync(path.join(stage, name), 0o755);
    }
  }
  // COPYFILE_DISABLE:macOS 的 tar 不要夾帶 `._*` 延伸屬性檔
  execFileSync(TAR, ["-czf", archive, "-C", work, "print-agent"], {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
}

const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
process.stdout.write(
  `${archiveName(platform)} ${String(statSync(archive).size)} bytes sha256=${sha256}\n`,
);
