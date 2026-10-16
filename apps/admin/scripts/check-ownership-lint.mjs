#!/usr/bin/env node
/**
 * 底座 / 專案所有權的 lint 負例:以 admin **正式的** ESLint 設定去 lint `lint-fixtures/ownership/` 的小型 `src/`,
 * 確認該擋的方向真的被擋、該放行的沒被誤擋,而且原本的分層與循環依賴檢查都還在。
 * 接在 `lint` script 後面跑,所以 CI 的 lint 會連這一步一起驗。
 *
 * 為什麼用夾具而不是正式的 `src/`:正式的專案來源是空的(沒有東西可以被誤 import),
 * 規則被設定檔改壞、或被後寫的設定整個蓋掉時,`eslint src/` 仍然全綠,看不出來。
 *
 * 夾具放在 `src/` 以外(`eslint src/`、tsc、jest 都不會掃到);ESLint 以夾具目錄為工作目錄執行,
 * 因為 `import-x/no-restricted-paths` 的 `basePath: "./src"` 是相對於工作目錄解析的。
 *
 * 另外檢查正式 `src/` 的 components / hooks / stores / lib 底下只有 `base/` 與 `project/`(STRUCT-12):
 * 放在層根目錄的檔案不屬於任何一方,所有權規則與底座同步工具都無從判斷。
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(appRoot, "lint-fixtures", "ownership");
const RESTRICTED = "import-x/no-restricted-paths";
const CYCLE = "import-x/no-cycle";

/**
 * 夾具檔 → 預期。`restricted` = 那個檔案裡被 `no-restricted-paths` 擋下的 import 各自訊息裡要出現的字
 * (空陣列 = 一個都不該擋);`cycle` = 要不要報循環依賴。沒列的夾具檔一律預期兩種都沒有。
 */
const EXPECTATIONS = {
  // 底座 → 專案:每一層都拒絕
  "src/app/base/imports-project-entry.ts": { restricted: ["專案來源"] },
  "src/pages/base/imports-project-page.ts": { restricted: ["專案來源"] },
  "src/components/base/imports-project-component.ts": {
    restricted: ["專案來源"],
  },
  "src/components/base/imports-project-hook.ts": { restricted: ["專案來源"] },
  "src/hooks/base/imports-project-hook.ts": { restricted: ["專案來源"] },
  "src/stores/base/imports-project-store.ts": { restricted: ["專案來源"] },
  "src/lib/base/imports-project-lib.ts": { restricted: ["專案來源"] },
  // 專案頁 → 底座頁內部:拒絕
  "src/pages/project/imports-base-page.ts": { restricted: ["底座頁的內部"] },
  // 原本的分層照舊(含專案自己的檔案):components → pages 仍拒絕
  "src/components/base/imports-page.ts": { restricted: ["STRUCT-03"] },
  "src/components/project/imports-page.ts": { restricted: ["STRUCT-03"] },
  // 循環依賴照舊
  "src/lib/base/cycle-a.ts": { cycle: true },
  "src/lib/base/cycle-b.ts": { cycle: true },
  // 允許:固定組裝入口、專案 → 共用(components / lib)與專案自己的來源、底座組裝、test 支援檔
  "src/app/module-pages.tsx": {},
  "src/app/base/module-pages.ts": {},
  "src/app/project/module-pages.ts": {},
  "src/app/project/page-replacements.ts": {},
  "src/pages/project/project-page.ts": {},
  "src/stores/project/imports-base-lib.ts": {},
  "src/test/imports-project.ts": {},
};

const fail = (message, details = []) => {
  console.error(`check:ownership-lint ✗ ${message}`);
  for (const item of details) console.error(`  - ${item}`);
  process.exit(1);
};

// 與 `lint` script 同一份 ESLint(admin 自己的 devDependency)
const eslintBin = join(appRoot, "node_modules", "eslint", "bin", "eslint.js");
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
    relative(fixtureRoot, result.filePath).split(sep).join("/"),
    result.messages,
  ]),
);

const problems = [];
for (const [file, messages] of byFile) {
  const fatal = messages.filter((message) => message.fatal === true);
  if (fatal.length > 0) {
    problems.push(`${file}:解析失敗(${fatal[0].message})`);
  }
}

for (const file of Object.keys(EXPECTATIONS)) {
  if (!byFile.has(file)) {
    problems.push(`${file}:夾具檔不見了,或沒有被 ESLint 掃到`);
  }
}

for (const [file, messages] of byFile) {
  const expected = EXPECTATIONS[file] ?? {};
  const restricted = messages
    .filter((message) => message.ruleId === RESTRICTED)
    .map((message) => message.message);
  const wanted = expected.restricted ?? [];
  if (
    restricted.length !== wanted.length ||
    wanted.some((needle) => !restricted.some((text) => text.includes(needle)))
  ) {
    problems.push(
      `${file}:預期 ${RESTRICTED} 擋下 ${String(wanted.length)} 個 import` +
        `(訊息含 ${wanted.map((needle) => `「${needle}」`).join("、") || "—"}),` +
        `實際 ${String(restricted.length)} 個${restricted.length > 0 ? `:${restricted.join(" / ")}` : ""}`,
    );
  }
  const hasCycle = messages.some((message) => message.ruleId === CYCLE);
  if (hasCycle !== (expected.cycle === true)) {
    problems.push(
      `${file}:預期${expected.cycle === true ? "要" : "不"}報 ${CYCLE},實際${hasCycle ? "有" : "沒有"}`,
    );
  }
}

/** 這幾層只能有 `base/` 與 `project/` 兩個子目錄(`app/`、`pages/` 另有固定入口,不在此列)。 */
const SPLIT_LAYERS = ["components", "hooks", "stores", "lib"];
for (const layer of SPLIT_LAYERS) {
  for (const entry of readdirSync(join(appRoot, "src", layer), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory() && ["base", "project"].includes(entry.name)) {
      continue;
    }
    problems.push(
      `src/${layer}/${entry.name}:${layer}/ 底下只能有 base/ 與 project/,請搬進其中一個`,
    );
  }
}

if (problems.length > 0) {
  fail("所有權 / 分層的 lint 行為與預期不符:", problems);
}

console.log(
  `check:ownership-lint ✓ ${String(byFile.size)} 個夾具檔的結果都符合預期` +
    "(底座→專案拒絕、專案→共用允許、固定入口允許、分層與循環依賴照舊);" +
    "components / hooks / stores / lib 只有 base/ 與 project/",
);
