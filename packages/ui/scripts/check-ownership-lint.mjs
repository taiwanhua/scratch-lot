#!/usr/bin/env node
/**
 * `@repo/ui` 所有權的 lint 負例(STRUCT-12;admin 的同名檢查見 `apps/admin/scripts/check-ownership-lint.mjs`):
 * 以 ui **正式的** ESLint 設定去 lint `lint-fixtures/ownership/` 的小型 `src/`,確認
 * ①import `apps/` 路徑或 app 套件被擋 ②`project/` 底下的程式被擋 ③一般檔案沒被誤擋;
 * 再掃整個 `packages/ui`(`node_modules`、`dist`、`lint-fixtures` 除外)確認沒有任何 `project/` 目錄
 * (含非程式檔與 src 以外的位置,lint 看不到),並以夾具驗證掃描本身抓得到。
 * 接在 `lint` script 後面跑,所以 CI 的 lint 會連這一步一起驗。
 *
 * 夾具放在 `src/` 以外(`eslint src/`、jest 都不會掃到;tsconfig 已排除);ESLint 以夾具目錄為工作目錄執行。
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(packageRoot, "lint-fixtures", "ownership");

/** 夾具檔 → 預期被報的規則與訊息關鍵字;沒列的規則不檢查(只看所有權相關的兩條)。 */
const EXPECTATIONS = {
  "src/imports-app-path.ts": { "no-restricted-imports": "apps/" },
  "src/imports-app-package.ts": { "no-restricted-imports": "apps/" },
  "src/project/project-part.ts": { "no-restricted-syntax": "project/" },
  "src/good-part.ts": {},
};
const RULES = ["no-restricted-imports", "no-restricted-syntax"];

const toPosix = (path) => path.split(sep).join("/");

/** 掃描時整個跳過的目錄名:依賴、建置產物,以及刻意放了 `project/` 的夾具。 */
const SKIP_DIRS = new Set(["node_modules", "dist", "lint-fixtures"]);

/** 某個根目錄底下所有名為 `project` 的目錄(相對於根,posix;跳過 `SKIP_DIRS`)。 */
const findProjectDirs = (root, dir = root) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
    .flatMap((entry) => {
      const full = join(dir, entry.name);
      const nested = findProjectDirs(root, full);
      return entry.name === "project"
        ? [toPosix(relative(root, full)), ...nested]
        : nested;
    });

const fail = (message, details = []) => {
  console.error(`check:ownership-lint ✗ ${message}`);
  for (const item of details) console.error(`  - ${item}`);
  process.exit(1);
};

const eslintBin = join(
  packageRoot,
  "node_modules",
  "eslint",
  "bin",
  "eslint.js",
);
const run = spawnSync(
  process.execPath,
  [eslintBin, "src", "--format", "json", "--no-warn-ignored"],
  { cwd: fixtureRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

let results;
try {
  results = JSON.parse(run.stdout);
} catch {
  fail("ESLint 沒有輸出可解析的結果", [run.stderr.trim() || run.stdout.trim()]);
}

const byFile = new Map(
  results.map((result) => [
    toPosix(relative(fixtureRoot, result.filePath)),
    result.messages,
  ]),
);

const problems = [];
for (const [file, expected] of Object.entries(EXPECTATIONS)) {
  const messages = byFile.get(file);
  if (messages === undefined) {
    problems.push(`${file}:夾具檔不見了,或沒有被 ESLint 掃到`);
    continue;
  }
  const fatal = messages.find((message) => message.fatal === true);
  if (fatal !== undefined) problems.push(`${file}:解析失敗(${fatal.message})`);
  for (const rule of RULES) {
    const hits = messages.filter((message) => message.ruleId === rule);
    const needle = expected[rule];
    if (needle === undefined ? hits.length > 0 : hits.length !== 1) {
      problems.push(
        `${file}:預期 ${rule} ${needle === undefined ? "不報" : "報 1 個"},實際 ${String(hits.length)} 個`,
      );
    } else if (needle !== undefined && !hits[0].message.includes(needle)) {
      problems.push(
        `${file}:${rule} 的訊息沒有「${needle}」:${hits[0].message}`,
      );
    }
  }
}

// 目錄掃描:夾具一定要被抓到(掃描本身有效),整個 packages/ui 一個都不能有
const fixtureDirs = findProjectDirs(fixtureRoot);
if (!fixtureDirs.includes("src/project")) {
  problems.push(
    `目錄掃描沒抓到夾具的 src/project(實際:${fixtureDirs.join("、") || "無"})`,
  );
}
for (const dir of findProjectDirs(packageRoot)) {
  problems.push(
    `${dir}:@repo/ui 不能有 project/ 目錄(STRUCT-12);專案元件放 admin 的 components/project/`,
  );
}

if (problems.length > 0) {
  fail("@repo/ui 的所有權檢查與預期不符:", problems);
}

console.log(
  `check:ownership-lint ✓ ${String(Object.keys(EXPECTATIONS).length)} 個夾具檔符合預期` +
    "(import apps 拒絕、project/ 程式拒絕);packages/ui 沒有 project/ 目錄",
);
