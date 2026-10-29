#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook:AI 每次 Edit/Write 完檔案後,對該檔跑 `prettier --check`
 * (CI 也守這一關),ts/tsx 再多跑 ESLint 與該檔所屬套件的 typecheck。
 * 失敗時以 exit code 2 把錯誤回饋給 AI 當場修正 — 三層約束第一層的閉環。
 *
 * 工作目錄是被編輯檔案往上找到的 repo / worktree 根(`repo-root.mjs`),不是 session 的 `process.cwd()`:
 * session 在主 checkout 啟動、編輯 git worktree 裡的檔案時,檢查與 typecheck 開關都以那個 worktree 為準。
 *
 * 速度(2026-09-19 調整):
 * - ESLint 開 `--cache`(cache 放套件的 node_modules/.cache,不入版控),第二次起只重算改過的檔
 * - typecheck 直接跑 `tsc --noEmit --incremental`(buildinfo 同樣放 node_modules/.cache),不經 turbo:
 *   turbo 的快取檔案一改就失效、每次全量;tsc 的 incremental 只重算受影響的部分
 * - 關閉 typecheck(重構型工作「先搬檔再修 import」中途必紅,跑了只是浪費):
 *   環境變數 `CLAUDE_HOOK_TYPECHECK=off`,或在 repo 根放一個空檔 `.claude/hook-typecheck-off`(已 gitignore;
 *   agent 開工時建、交件前刪 — PR 前本來就要求 lint / typecheck / test 全綠,閉環不破)
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { findRepoRoot } from "./repo-root.mjs";

let filePath = "";
try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  filePath = input.tool_input?.file_path ?? input.tool_response?.filePath ?? "";
} catch {
  process.exit(0);
}

// 只檢查 prettier 守門的副檔名(與根 package.json 的 format / format:check 同一組);產物與外部程式碼跳過
if (!/\.(ts|tsx|js|mjs|cjs|json|ya?ml|md)$/.test(filePath)) process.exit(0);
const normalized = filePath.replaceAll("\\", "/");
if (
  normalized.includes("/node_modules/") ||
  normalized.includes("/generated/") ||
  normalized.includes("/dist/") ||
  normalized.includes("/.next/")
) {
  process.exit(0);
}

// 以被編輯檔案所屬的 repo / worktree 根為工作目錄(session 可能在主 checkout 啟動、卻編輯 worktree 裡的檔);
// 之後的指令一律用絕對路徑,不受工作目錄影響
const repoRoot = findRepoRoot(filePath, process.cwd());
filePath = path.resolve(process.cwd(), filePath);

const run = (command, cwd) => {
  try {
    execSync(command, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    return null;
  } catch (error) {
    const stdout = error.stdout?.toString() ?? "";
    const stderr = error.stderr?.toString() ?? "";
    return `${stdout}\n${stderr}`.trim();
  }
};

// 1) 對該檔跑 prettier --check(單檔約一秒;.prettierignore 內的檔案會被跳過)
const formatError = run(
  `pnpm exec prettier --check --ignore-unknown "${filePath}"`,
  repoRoot,
);
if (formatError !== null) {
  console.error(
    `[hook] prettier 格式未通過:${filePath}(跑 \`pnpm exec prettier --write "${filePath}"\`)\n${formatError}`,
  );
  process.exit(2);
}

// 以下只對 ts/tsx:ESLint 與所屬套件的 typecheck
if (!/\.(ts|tsx)$/.test(filePath)) process.exit(0);

// 往上找檔案所屬的 workspace 套件
let pkgDir = path.dirname(filePath);
while (pkgDir !== repoRoot && !existsSync(path.join(pkgDir, "package.json"))) {
  const parent = path.dirname(pkgDir);
  if (parent === pkgDir) process.exit(0); // 走出檔案系統頂端,跳過
  pkgDir = parent;
}
if (pkgDir === repoRoot) process.exit(0); // root 層檔案沒有 lint 設定,跳過

const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const cacheDir = path.join(pkgDir, "node_modules", ".cache", "claude-hook");
mkdirSync(cacheDir, { recursive: true });

// 2) 對該檔跑 ESLint(與 CI 同一套規則;--cache 讓沒改的檔不重算)
if (pkg.scripts?.lint) {
  const lintError = run(
    `pnpm exec eslint --max-warnings 0 --cache --cache-location "${path.join(cacheDir, "eslint")}" "${filePath}"`,
    pkgDir,
  );
  if (lintError !== null) {
    console.error(`[hook] ESLint 未通過:${filePath}\n${lintError}`);
    process.exit(2);
  }
}

// 3) 對該套件跑 typecheck(型別錯誤會跨檔案);可關閉,見檔頭
const typecheckOff =
  process.env.CLAUDE_HOOK_TYPECHECK === "off" ||
  existsSync(path.join(repoRoot, ".claude", "hook-typecheck-off"));
if (!typecheckOff && pkg.scripts?.["check-types"]) {
  const typeError = run(
    `pnpm exec tsc --noEmit --incremental --tsBuildInfoFile "${path.join(cacheDir, "tsc.tsbuildinfo")}"`,
    pkgDir,
  );
  if (typeError !== null) {
    console.error(`[hook] 型別檢查未通過(${pkg.name})\n${typeError}`);
    process.exit(2);
  }
}

process.exit(0);
