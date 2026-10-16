/**
 * base-sync verify 的驗收測試:以 test-support 的真 Git 夾具建一次「已升級」的專案,
 * 乾淨情境與四種不乾淨情境各從同一個升級 merge 開分支,報告對應節要列出正確的檔案 / key。
 * gh 換成假實作(系統邊界);verify 本身不呼叫 gh、不 fetch。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, test } from "node:test";

import { runBaseSync } from "./base-sync.mjs";
import {
  BASE_REPOSITORY,
  commitFiles,
  createFixture,
  fixtureFetch,
  git,
  isolateGitConfig,
  publishedReleaseGh,
} from "./test-support.mjs";
import { exportNames, stripComments } from "./verify.mjs";

const TAG = "v0.3.0";

/** 新底座 v0.3.0:有 key 的 seed、底座 hook 與 lib、空的專案登記(底座帶的預設)。 */
const BASE_V3_CHANGES = {
  "apps/db-migrator/seeds/base/modules/lottery.ts": [
    'export const LOTTERY_MODULE_KEY = "lottery";',
    "export const lotteryModule = {",
    "  nodes: [{ key: LOTTERY_MODULE_KEY, name: '刮刮樂', parentKey: null }],",
    "};",
    "",
  ].join("\n"),
  "apps/db-migrator/seeds/base/roles.ts": [
    "export const roles = {",
    '  kind: "documents",',
    '  collection: "roles",',
    '  entries: [{ key: "admin", data: { name: "管理員" } }],',
    "};",
    "",
  ].join("\n"),
  "apps/admin/src/hooks/base/useScanner.ts":
    "export function useScanner() {\n  return null;\n}\n",
  "apps/admin/src/lib/base/report-period.ts":
    "export const reportPeriod = 1;\nexport type Period = number;\n",
  "apps/admin/src/app/project/page-replacements.ts": [
    "// 範例:{ target: 'commented', Page: X } 不算登記",
    "export const projectPageReplacements: readonly ModulePageReplacement[] = [];",
    "",
  ].join("\n"),
  "apps/admin/src/app/project/module-pages.ts":
    "export const projectModulePages = {\n  pages: [],\n  forms: [],\n};\n",
  "apps/admin/src/md/module-help/project/replacements/.gitkeep": "",
  "apps/db-migrator/seeds/project/registry.ts":
    "export const projectSeedSource = { moduleDeclarations: [], seeds: [] };\n",
};

let fixture;
let worktree;
let mergeCommit;

before(async () => {
  isolateGitConfig();
  fixture = createFixture({ projects: ["gadgets"] });
  const { src } = fixture.base;
  commitFiles(src, BASE_V3_CHANGES, "base v0.3.0");
  git(src, "tag", "-a", TAG, "-m", TAG);
  git(src, "push", "-q", "origin", "main", `refs/tags/${TAG}`);

  const gh = publishedReleaseGh({
    releases: { [`${BASE_REPOSITORY}#${TAG}`]: {} },
  });
  const upgraded = await runBaseSync(
    [
      "upgrade",
      "--project",
      fixture.projects.gadgets.root,
      "--tag",
      TAG,
      "--worktree-root",
      fixture.worktreeRoot,
    ],
    { runExternal: gh.runExternal, fetchRemote: fixtureFetch },
  );
  assert.equal(upgraded.exitCode, 0, upgraded.stderr);
  const [project] = JSON.parse(upgraded.stdout).projects;
  assert.deepEqual(project.conflicts, []);
  worktree = project.worktree;
  git(worktree, "commit", "-q", "--no-edit");
  mergeCommit = git(worktree, "rev-parse", "HEAD");
});

/** 從升級 merge 開一條情境分支並提交 `files`;回傳 verify 的結果。 */
async function verifyScenario(name, files, extra = []) {
  git(worktree, "checkout", "-q", "-b", `scenario-${name}`, mergeCommit);
  if (files) commitFiles(worktree, files, `scenario ${name}`);
  const fail = () => {
    throw new Error("verify 不該呼叫 gh 或 fetch");
  };
  return runBaseSync(
    ["verify", "--project", worktree, "--tag", TAG, ...extra],
    { runExternal: fail, fetchRemote: fail },
  );
}

/** 報告某一節(`## <n>.` 起、到下一個 `## ` 為止)的項目行。 */
function sectionLines(markdown, number) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${number}.`));
  assert.notEqual(start, -1, `缺少第 ${number} 節`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) =>
    line.startsWith("- "),
  );
}

/** 只有 `number` 那一節有項目,其餘三節為 0。 */
function assertOnlySection(result, number) {
  assert.equal(result.exitCode, 1, result.stdout);
  assert.equal(result.stderr, "");
  for (const other of [1, 2, 3, 4]) {
    if (other === number) continue;
    assert.deepEqual(sectionLines(result.stdout, other), [], `第 ${other} 節`);
  }
  return sectionLines(result.stdout, number);
}

test("乾淨:升級 merge 後四節皆為 0,exit 0 並註明已去除重複;--out 另寫同一份報告", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "base-sync-verify-out-"));
  try {
    const out = path.join(dir, "verify.md");
    const result = await verifyScenario("clean", null, ["--out", out]);
    assert.equal(result.exitCode, 0, result.stdout);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /已去除重複/);
    assert.match(result.stdout, new RegExp(`acme/gadgets 對照底座 ${TAG}`));
    for (const number of [1, 2, 3, 4]) {
      assert.deepEqual(sectionLines(result.stdout, number), []);
    }
    assert.equal(readFileSync(out, "utf8"), result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("不乾淨 1:共用路徑改了或多了檔案,第 1 節逐檔列出;專案路徑的差異不列", async () => {
  const result = await verifyScenario("common", {
    "packages/ui/src/tokens.ts": "export const spacing = 12;\n",
    "packages/ui/src/project-only.ts": "export const extra = 1;\n",
    "packages/project-config/src/project/public.ts":
      "export const brand = 'gadgets-2';\n",
  });
  assert.deepEqual(assertOnlySection(result, 1), [
    "- A `packages/ui/src/project-only.ts`",
    "- M `packages/ui/src/tokens.ts`",
  ]);
});

test("不乾淨 2:頁面替換、help 替換與表單 options / pageOverrides 都列進第 2 節", async () => {
  const result = await verifyScenario("customizations", {
    "apps/admin/src/app/project/page-replacements.ts": [
      "export const projectPageReplacements: readonly ModulePageReplacement[] = [",
      '  { target: "users", Page: CustomUsersPage, minWidth: "xl" },',
      "  ...moreReplacements,",
      "];",
      "",
    ].join("\n"),
    "apps/admin/src/md/module-help/project/replacements/users.help.md":
      "# 使用者\n",
    "apps/admin/src/app/project/module-pages.ts": [
      "export const projectModulePages = {",
      "  pages: [{ key: 'tickets', Page: TicketsPage }],",
      "  forms: [",
      "    { moduleKey: 'ticket', options: { tabLabelTemplate: '{{title}}' } },",
      "    { moduleKey: 'plain' },",
      "    {",
      "      moduleKey: 'leave',",
      "      pageOverrides: { list: { Page: LeaveListPage } },",
      "    },",
      "  ],",
      "};",
      "",
    ].join("\n"),
  });
  assert.deepEqual(assertOnlySection(result, 2), [
    "- 頁面替換 `users`(`apps/admin/src/app/project/page-replacements.ts`)",
    "- 頁面替換(`apps/admin/src/app/project/page-replacements.ts`):無法靜態解析的登記:...moreReplacements",
    "- help 替換 `users`(`apps/admin/src/md/module-help/project/replacements/users.help.md`)",
    "- 表單模組設定 `ticket`(`apps/admin/src/app/project/module-pages.ts`):options",
    "- 表單模組設定 `leave`(`apps/admin/src/app/project/module-pages.ts`):pageOverrides",
  ]);
});

test("不乾淨 3:專案 seed 宣告了底座 seed 已有的 key,第 3 節列出 key 與兩邊檔案;引用與歷史快照不算", async () => {
  const result = await verifyScenario("seeds", {
    "apps/db-migrator/seeds/project/modules.ts": [
      'import { LOTTERY_MODULE_KEY } from "../base/modules/lottery";',
      "export const projectModules = {",
      "  nodes: [",
      "    { key: LOTTERY_MODULE_KEY, name: '刮刮樂(專案版)' },",
      "    { key: 'own-module', name: '專案自己的' },",
      "  ],",
      "};",
      "// { key: 'admin' } 註解裡的不算",
      "export const ownerRef = { collection: 'roles', key: 'admin' };",
      "",
    ].join("\n"),
    // 只給 migration 明示套用的歷史快照:不是目前宣告
    "apps/db-migrator/seeds/project/revisions/old.r1.seed.ts":
      "export const seed = { entries: [{ key: 'lottery' }] };\n",
    // 設計器匯出、被 registry import 的快照:是目前宣告
    "apps/db-migrator/seeds/project/revisions/roles.r1.seed.ts":
      'export const seed = { entries: [{ key: "admin", data: {} }] };\n',
    "apps/db-migrator/seeds/project/registry.ts": [
      'import { seed as projectRoles } from "./revisions/roles.r1.seed";',
      "export const projectSeedSource = { moduleDeclarations: [], seeds: [projectRoles] };",
      "",
    ].join("\n"),
  });
  assert.deepEqual(assertOnlySection(result, 3), [
    "- `admin`:底座 `apps/db-migrator/seeds/base/roles.ts`;專案 `apps/db-migrator/seeds/project/revisions/roles.r1.seed.ts`",
    "- `lottery`:底座 `apps/db-migrator/seeds/base/modules/lottery.ts`;專案 `apps/db-migrator/seeds/project/modules.ts`",
  ]);
});

test("不乾淨 4:專案路徑的檔案與底座同名或同匯出名稱,第 4 節列出;固定來源與專案值不算", async () => {
  const result = await verifyScenario("names", {
    "apps/admin/src/hooks/project/useScanner.ts":
      "export function useProjectScanner() {\n  return 1;\n}\n",
    "apps/admin/src/lib/project/period.ts":
      "const value = 2;\nexport { value as reportPeriod };\nexport const own = 3;\n",
    "apps/admin/src/lib/project/unique.ts": "export const uniqueThing = 1;\n",
    "apps/api/src/project/project.module.ts": "export class ProjectModule {}\n",
  });
  assert.deepEqual(assertOnlySection(result, 4), [
    "- `apps/admin/src/hooks/project/useScanner.ts`:同名 `apps/admin/src/hooks/base/useScanner.ts`",
    "- `apps/admin/src/lib/project/period.ts`:同匯出 `reportPeriod`(`apps/admin/src/lib/base/report-period.ts`)",
  ]);
});

test("拒絕:底座版本沒被 upgrade 存過、或 HEAD 還沒包含它時,stdout 空、exit 1", async () => {
  const fail = () => {
    throw new Error("verify 不該呼叫 gh 或 fetch");
  };
  const boundaries = { runExternal: fail, fetchRemote: fail };
  git(worktree, "checkout", "-q", "-b", "scenario-reject", mergeCommit);

  const missing = await runBaseSync(
    ["verify", "--project", worktree, "--tag", "v9.9.9"],
    boundaries,
  );
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /refs\/base\/releases\/v9\.9\.9;先以 upgrade/);

  const notMerged = await runBaseSync(
    ["verify", "--project", fixture.projects.gadgets.root, "--tag", TAG],
    boundaries,
  );
  assert.equal(notMerged.exitCode, 1);
  assert.equal(notMerged.stdout, "");
  assert.match(notMerged.stderr, /HEAD 尚未包含底座 v0\.3\.0/);

  const badOut = await runBaseSync(
    [
      "verify",
      "--project",
      worktree,
      "--tag",
      TAG,
      "--out",
      path.join(fixture.root, "no-such-dir", "verify.md"),
    ],
    boundaries,
  );
  assert.deepEqual(badOut, {
    exitCode: 1,
    stdout: "",
    stderr: "base-sync: --out 的目錄不存在\n",
  });
});

test("掃描工具:去註解保留字串;匯出名稱含宣告、清單與改名,不含 default", () => {
  assert.equal(
    stripComments("const a = '// 不是註解'; // 註解\n/* 區塊\n註解 */b"),
    "const a = '// 不是註解'; \n\nb",
  );
  assert.deepEqual(
    [
      ...exportNames(
        [
          "export default function Page() {}",
          "export async function load() {}",
          "export type Props = {};",
          "export { a as renamed, type B, default as Ignored };",
          "// export const commented = 1;",
        ].join("\n"),
      ),
    ].sort(),
    ["B", "Ignored", "Page", "load", "Props", "renamed"].sort(),
  );
});
