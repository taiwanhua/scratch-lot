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
import {
  exportNames,
  projectExportLines,
  resolveKeyExpression,
  seedKeys,
  stripComments,
} from "./verify.mjs";

const TAG = "v0.3.0";

/** 新底座 v0.3.0:有 key 的 seed、底座 hook 與 lib、空的專案登記(底座帶的預設)。 */
const BASE_V3_CHANGES = {
  // 值行檔(第 6 節):範本值、標題與 README 開頭是專案值,其餘照底座
  ".env.example":
    "# 本機的應用名稱\nAPP_NAME=base\n# APP_URL=http://base.test\n",
  "CLAUDE.md": "# base\n\n規則\n",
  "README.md": "# base\n\n底座介紹\n\n## 結構\n\n內容\n",
  "docker-compose.yml": "services: {}\n",
  "apps/db-migrator/seeds/base/modules/demo.ts": [
    'export const DEMO_MODULE_KEY = "demo";',
    "export const DEMO_HISTORY_KEY = `${DEMO_MODULE_KEY}.history-page`;",
    "export const demoModule = {",
    "  nodes: [",
    "    { key: DEMO_MODULE_KEY, name: '示範', parentKey: null },",
    "    { key: DEMO_HISTORY_KEY, name: '紀錄', parentKey: DEMO_MODULE_KEY },",
    "  ],",
    '  permissions: [{ key: permissionKey(DEMO_MODULE_KEY, "draw") }],',
    "};",
    "// 底座的 helper 寫法:無法靜態解析,只計數",
    "export const helper = (key) => ({ key: key });",
    "",
  ].join("\n"),
  // 表單模組 helper:推導出的頁面與權限 key 以 helper 本身的宣告為樣板
  "apps/db-migrator/seeds/base/form-module-declaration.ts": [
    "export function formModuleDeclaration(spec) {",
    "  const { key, name } = spec;",
    "  return {",
    "    nodes: [{ key, name }, { key: `${key}.view-page`, name: '詳情' }],",
    '    permissions: [{ key: permissionKey(key, "view") }],',
    "  };",
    "}",
    "",
  ].join("\n"),
  "apps/db-migrator/seeds/base/modules/requests.ts": [
    'import { formModuleDeclaration } from "../form-module-declaration";',
    "export const requestsModule = formModuleDeclaration({",
    '  key: "requests",',
    '  name: "申請",',
    "});",
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
  "apps/admin/src/app/base/realtime-signals.ts":
    "export const baseRealtimeSignals = [];\n",
  // 與專案固定來源 `project/user-preferences.ts` 同名的底座檔:固定來源不算重名
  "apps/api/src/user-preferences/user-preferences.ts":
    "export const BASE_USER_PREFERENCES = [];\n",
  // 與專案固定來源 `project/form-lifecycles.ts` 同名的底座檔:固定來源不算重名
  "apps/api/src/workflows/form-lifecycles.ts":
    "export const BASE_FORM_LIFECYCLES = [];\n",
  // 與專案固定來源 `project/notifications.ts` 同名的底座檔:固定來源不算重名
  "apps/api/src/notifications/notifications.ts":
    "export const BASE_NOTIFICATION_TYPES = [];\n",
  // 第 4 節的慣例檔名與錯誤 helper:底座各模組各有一份
  "apps/api/src/database/registration.ts":
    "export const defineRegistration = (x) => x;\n",
  "packages/domain/src/form/keys.ts": 'export const FORM_KEY = "form";\n',
  "apps/api/src/forms/forms-error.ts":
    "export const notFoundError = () => 1;\nexport const sharedHelper = () => 2;\n",
  "apps/api/src/lib/parse.ts": "export const parseError = () => 3;\n",
  // 第 4 節的模組慣例常數與測試輔助:底座各模組 / 各測試各有一份
  "apps/api/src/gizmos/dto/gizmos.input.ts":
    "export const DEFAULT_PAGE_SIZE = 20;\nexport const MAX_PAGE_SIZE = 100;\n",
  "apps/api/src/gizmos/gizmo-mapper.ts":
    "export const AUDIT_ACTIONS = { create: 'gizmo.create' };\n",
  // 共用套件匯出的同名常數:專案該用這一份
  "packages/domain/src/redaction.ts": "export const REDACTED = '***';\n",
  "apps/api/src/gizmos/test-support/fixtures.ts":
    "export const PASSWORD = 'pw';\nexport const P = {};\n",
  "apps/admin/src/test/viewport.ts":
    "export const setViewportWidth = () => {};\n",
  // 底座在 project/ 路徑帶空版的固定來源(專案填內容);對應的底座檔同名
  "apps/api/src/project/database/tenant-purge.ts":
    "export const PROJECT_TENANT_PURGE = [];\n",
  "apps/api/src/database/tenant-purge.ts":
    "export const purgeTenant = () => 0;\n",
  // 測試裡當夾具的程式碼字串不是匯出
  "scripts/tools/sample.test.mjs":
    'const fixture = "export function useWidget() {}";\n',
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

/** 第 3 節後另列的「無法解析的 key」(縮排項目,不計入結果)。 */
const unresolvedLines = (markdown) =>
  markdown.split("\n").filter((line) => line.startsWith("  - 無法解析的 key"));

/** 只有 `number` 那一節有項目,其餘各節為 0。 */
function assertOnlySection(result, number) {
  assert.equal(result.exitCode, 1, result.stdout);
  assert.equal(result.stderr, "");
  for (const other of [1, 2, 3, 4, 5, 6, 7]) {
    if (other === number) continue;
    assert.deepEqual(sectionLines(result.stdout, other), [], `第 ${other} 節`);
  }
  return sectionLines(result.stdout, number);
}

test("乾淨:升級 merge 後七節皆為 0,exit 0 並註明已去除重複;--out 另寫同一份報告", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "base-sync-verify-out-"));
  try {
    const out = path.join(dir, "verify.md");
    const result = await verifyScenario("clean", null, ["--out", out]);
    assert.equal(result.exitCode, 0, result.stdout);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /已去除重複/);
    assert.match(result.stdout, new RegExp(`acme/gadgets 對照底座 ${TAG}`));
    for (const number of [1, 2, 3, 4, 5, 6, 7]) {
      assert.deepEqual(sectionLines(result.stdout, number), []);
    }
    assert.equal(readFileSync(out, "utf8"), result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("不乾淨 1:共用路徑改了或多了檔案,第 1 節逐檔列出並標類別;專案路徑的差異不列", async () => {
  const result = await verifyScenario("common", {
    "packages/ui/src/tokens.ts": "export const spacing = 12;\n",
    "packages/ui/src/project-only.ts": "export const extra = 1;\n",
    "packages/project-config/src/project/public.ts":
      "export const brand = 'gadgets-2';\n",
  });
  assert.deepEqual(assertOnlySection(result, 1), [
    "- common A `packages/ui/src/project-only.ts`",
    "- common M `packages/ui/src/tokens.ts`",
  ]);
});

test("不乾淨 1b:專案改寫了底座已發布的種子快照,第 1 節以 published-data 列出", async () => {
  const result = await verifyScenario("published", {
    "apps/db-migrator/seeds/base/revisions/roles.r1.json": '{"roles":["y"]}\n',
  });
  assert.deepEqual(assertOnlySection(result, 1), [
    "- published-data M `apps/db-migrator/seeds/base/revisions/roles.r1.json`",
  ]);
});

test("不乾淨 1c:專案多了無法歸類的路徑,第 1 節以 unknown 列出;混合路徑不列", async () => {
  const result = await verifyScenario("unknown", {
    "misc/project-notes.txt": "project only\n",
    ".github/project-guide.md": "# 混合路徑由 inspect 核對\n",
  });
  assert.deepEqual(assertOnlySection(result, 1), [
    "- unknown A `misc/project-notes.txt`",
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

test("不乾淨 3:專案 seed 宣告了底座已有的 collection + key,第 3 節列出;無法解析的 key 另列、不計入;引用、別的 collection 與歷史快照不算", async () => {
  const result = await verifyScenario("seeds", {
    "apps/db-migrator/seeds/project/modules.ts": [
      'import { DEMO_MODULE_KEY } from "../base/modules/demo";',
      "export const projectModules = {",
      "  nodes: [",
      "    { key: DEMO_MODULE_KEY, name: '示範(專案版)' },",
      "    { key: `${DEMO_MODULE_KEY}.history-page`, name: '紀錄' },",
      "    { key: 'own-module', name: '專案自己的' },",
      "    { key: makeKey('x'), name: '讀不懂' },",
      "  ],",
      "  permissions: [",
      '    { key: permissionKey("demo", "draw") },',
      '    { key: "requests.view" },',
      "  ],",
      "};",
      "// { key: 'admin' } 註解裡的不算",
      "export const ownerRef = { collection: 'roles', key: 'admin' };",
      "export const categories = {",
      '  collection: "field_categories",',
      '  entries: [{ key: "admin", data: {} }],',
      "};",
      "",
    ].join("\n"),
    // 只給 migration 明示套用的歷史快照:不是目前宣告
    "apps/db-migrator/seeds/project/revisions/old.r1.seed.ts":
      "export const seed = { collection: 'modules', entries: [{ key: 'demo' }] };\n",
    // 設計器匯出、被 registry import 的快照:是目前宣告
    "apps/db-migrator/seeds/project/revisions/roles.r1.seed.ts":
      'export const seed = { collection: "roles", entries: [{ key: "admin", data: {} }] };\n',
    "apps/db-migrator/seeds/project/registry.ts": [
      'import { seed as projectRoles } from "./revisions/roles.r1.seed";',
      "export const projectSeedSource = { moduleDeclarations: [], seeds: [projectRoles] };",
      "",
    ].join("\n"),
  });
  const demo = "`apps/db-migrator/seeds/base/modules/demo.ts`";
  const modules = "`apps/db-migrator/seeds/project/modules.ts`";
  assert.deepEqual(assertOnlySection(result, 3), [
    "- roles `admin`:底座 `apps/db-migrator/seeds/base/roles.ts`;專案 `apps/db-migrator/seeds/project/revisions/roles.r1.seed.ts`",
    `- modules \`demo\`:底座 ${demo};專案 ${modules}`,
    `- permissions \`demo.draw\`:底座 ${demo};專案 ${modules}`,
    `- modules \`demo.history-page\`:底座 ${demo};專案 ${modules}`,
    `- permissions \`requests.view\`:底座 \`apps/db-migrator/seeds/base/modules/requests.ts\`;專案 ${modules}`,
  ]);
  // 專案無法解析的 key 另列一類(不算撞 key);底座的只計數,都不計入結果
  assert.deepEqual(unresolvedLines(result.stdout), [
    `  - 無法解析的 key \`makeKey('x')\`(${modules} 第 7 行)`,
  ]);
  assert.match(
    result.stdout,
    /專案 seed 另有 1 個 key 無法靜態解析,不算撞 key/,
  );
  assert.match(result.stdout, /底座 seed 另有 1 個 key 無法靜態解析/);
  assert.match(result.stdout, /尚有 5 項待判讀/);
});

test("不乾淨 3b:常數物件的成員與 import 進來的常數(套件子路徑、別名、export *)照樣解析成 key 比對;只有無法解析的不計入", async () => {
  const result = await verifyScenario("seed-imports", {
    "packages/domain/package.json": `${JSON.stringify({ name: "@repo/domain" })}\n`,
    "packages/domain/src/project/widgets/index.ts": 'export * from "./keys";\n',
    "packages/domain/src/project/widgets/keys.ts": [
      'import { DEMO_MODULE_KEY as BASE_DEMO } from "../../../../../apps/db-migrator/seeds/base/modules/demo";',
      "export const WIDGETS_KEY = BASE_DEMO;",
      "export const WIDGETS_KEYS = {",
      "  history: `${WIDGETS_KEY}.history-page`,",
      "  nested: { own: 'widgets.own' },",
      "} as const;",
      "",
    ].join("\n"),
    "apps/db-migrator/seeds/project/widgets.ts": [
      'import { WIDGETS_KEY, WIDGETS_KEYS as KEYS } from "@repo/domain/project/widgets";',
      "const LOCAL = { draw: permissionKey(WIDGETS_KEY, 'draw') } as const;",
      "export const widgetsModule = {",
      "  nodes: [",
      "    { key: WIDGETS_KEY, name: '撞底座的模組 key' },",
      "    { key: KEYS.history, name: '撞底座的頁面 key' },",
      "    { key: KEYS.nested.own, name: '專案自己的' },",
      "    { key: KEYS.missing, name: '物件沒有這個成員' },",
      "  ],",
      "  permissions: [{ key: LOCAL.draw }],",
      "};",
      "",
    ].join("\n"),
    // 同名別名在另一個檔指向別的物件:各檔各自解析,不互相污染
    "apps/db-migrator/seeds/project/others.ts": [
      "const KEYS = { history: 'others.history' };",
      "export const othersModule = { nodes: [{ key: KEYS.history, name: '別的' }] };",
      "",
    ].join("\n"),
    // 測試檔不是 seed 宣告
    "apps/db-migrator/seeds/project/widgets.test.ts":
      "const expected = { nodes: [{ key: 'demo' }] };\n",
  });
  const demo = "`apps/db-migrator/seeds/base/modules/demo.ts`";
  const widgets = "`apps/db-migrator/seeds/project/widgets.ts`";
  assert.deepEqual(assertOnlySection(result, 3), [
    `- modules \`demo\`:底座 ${demo};專案 ${widgets}`,
    `- permissions \`demo.draw\`:底座 ${demo};專案 ${widgets}`,
    `- modules \`demo.history-page\`:底座 ${demo};專案 ${widgets}`,
  ]);
  assert.deepEqual(unresolvedLines(result.stdout), [
    `  - 無法解析的 key \`KEYS.missing\`(${widgets} 第 8 行)`,
  ]);
});

test("不乾淨 3c:只有無法解析的 key 時第 3 節為 0、不計入結果", async () => {
  const result = await verifyScenario("seed-unresolved-only", {
    "apps/db-migrator/seeds/project/dynamic.ts":
      "export const m = { nodes: [{ key: makeKey('x'), name: '讀不懂' }] };\n",
  });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.deepEqual(sectionLines(result.stdout, 3), []);
  assert.deepEqual(unresolvedLines(result.stdout), [
    "  - 無法解析的 key `makeKey('x')`(`apps/db-migrator/seeds/project/dynamic.ts` 第 1 行)",
  ]);
  // 摘要點出待判讀的件數;第 3 節不寫「無。」
  assert.ok(
    result.stdout.includes("另有 1 個無法解析的 seed key 待判讀(不計入"),
    result.stdout,
  );
  assert.doesNotMatch(
    result.stdout.slice(
      result.stdout.indexOf("## 3."),
      result.stdout.indexOf("## 4."),
    ),
    /無。/,
  );
});

test("不乾淨 3d:讀不到的 import、spread 帶進來的成員與沒匯出的常數不從別檔同名常數取值,列為無法解析", async () => {
  const result = await verifyScenario("seed-no-borrow", {
    // import 讀不到(例:別名路徑);別檔剛好有同名常數物件
    "apps/db-migrator/seeds/project/a.ts": [
      'import { KEYS } from "~/unresolvable/keys";',
      "export const a = { nodes: [{ key: KEYS.viewPage, name: 'a' }] };",
      "",
    ].join("\n"),
    "apps/db-migrator/seeds/project/b.ts": [
      "const KEYS = { viewPage: 'other.view-page' };",
      "const PAGES = { viewPage: 'other.view-page' };",
      "export const b = { nodes: [] };",
      "",
    ].join("\n"),
    // spread 進來的成員不攤平:不可由 b.ts 的同名物件補上
    "apps/db-migrator/seeds/project/pages-src.ts": [
      "const BASE_PAGES = { viewPage: 'demo.view-page' };",
      "export const PAGES = { ...BASE_PAGES, extra: 'p.extra' };",
      "",
    ].join("\n"),
    "apps/db-migrator/seeds/project/c.ts": [
      'import { PAGES } from "./pages-src";',
      "export const c = { nodes: [{ key: PAGES.viewPage, name: 'c' }] };",
      "",
    ].join("\n"),
    // export * 只轉出有 export 的常數
    "apps/db-migrator/seeds/project/shared/index.ts":
      'export * from "./internal";\n',
    "apps/db-migrator/seeds/project/shared/internal.ts":
      'const HIDDEN = "demo";\nexport const SHOWN = "own.shown";\n',
    "apps/db-migrator/seeds/project/d.ts": [
      'import { HIDDEN, SHOWN } from "./shared";',
      "export const d = { nodes: [{ key: HIDDEN, name: 'd' }, { key: SHOWN, name: 'e' }] };",
      "",
    ].join("\n"),
  });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.deepEqual(sectionLines(result.stdout, 3), []);
  assert.deepEqual(unresolvedLines(result.stdout), [
    "  - 無法解析的 key `KEYS.viewPage`(`apps/db-migrator/seeds/project/a.ts` 第 2 行)",
    "  - 無法解析的 key `PAGES.viewPage`(`apps/db-migrator/seeds/project/c.ts` 第 2 行)",
    "  - 無法解析的 key `HIDDEN`(`apps/db-migrator/seeds/project/d.ts` 第 2 行)",
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
    // 固定組裝入口的專案來源:與底座同名(app/base/realtime-signals.ts)也不算重複
    "apps/admin/src/app/project/realtime-signals.ts":
      "export const projectRealtimeSignals = [];\n",
    "apps/api/src/project/realtime-boards.ts":
      "export const PROJECT_REALTIME_BOARDS = [];\n",
    "apps/api/src/project/user-preferences.ts":
      "export const PROJECT_USER_PREFERENCES = [];\n",
    "apps/api/src/project/form-lifecycles.ts":
      "export const PROJECT_FORM_LIFECYCLES = [];\n",
    "apps/api/src/project/notifications.ts":
      "export const PROJECT_NOTIFICATIONS = {};\n",
  });
  assert.deepEqual(assertOnlySection(result, 4), [
    "- `apps/admin/src/hooks/project/useScanner.ts`:同名 `apps/admin/src/hooks/base/useScanner.ts`",
    "- `apps/admin/src/lib/project/period.ts`:同匯出 `reportPeriod`(`apps/admin/src/lib/base/report-period.ts`)",
  ]);
});

test("不乾淨 4b:慣例檔名、各模組錯誤 helper、底座帶空版的固定來源與字串裡的範例不算;放在對應路徑或別種匯出照列", async () => {
  const result = await verifyScenario("name-conventions", {
    // 慣例檔名在模組自己的路徑:不算
    "apps/api/src/project/database/widgets/registration.ts":
      "export const widgetsRegistration = 1;\n",
    "packages/domain/src/project/widgets/keys.ts":
      'export const WIDGETS_KEY = "widgets";\n',
    "apps/api/src/project/widgets/test-support/fixtures.ts":
      "export const widgetFixture = 1;\n",
    // 慣例檔名但正好在底座那份的對應路徑(去掉 project/):照列
    "apps/api/src/project/database/registration.ts":
      "export const projectRegistration = 1;\n",
    "packages/domain/src/project/form/keys.ts":
      'export const PROJECT_FORM_KEY = "x";\n',
    // 模組自己的錯誤組裝檔:`…Error` helper 與底座 *-error.ts 同名不算;其他匯出照列
    "apps/api/src/project/widgets/widgets-error.ts": [
      "export const notFoundError = () => 1;",
      "export const sharedHelper = () => 2;",
      "export const parseError = () => 3;",
      "",
    ].join("\n"),
    // 不是錯誤組裝檔卻匯出同名 helper:照列
    "apps/api/src/project/widgets/widget-utils.ts":
      "export const notFoundError = () => 1;\n",
    // 底座在 project/ 路徑帶空版的固定來源與它的測試:不算
    "apps/api/src/project/database/tenant-purge.ts":
      "export const PROJECT_TENANT_PURGE = ['widgets'];\n",
    "apps/api/src/project/database/tenant-purge.test.ts":
      "export const purgeCase = 1;\n",
    // 同名但不在固定來源的位置(例:升格後沒刪的那份):照列
    "apps/api/src/project/widgets/tenant-purge.ts":
      "export const purgeTenant = () => 0;\n",
    // 底座只在測試字串裡寫過 useWidget:不是匯出
    "apps/admin/src/hooks/project/useWidget.ts":
      "export function useWidget() {\n  return 1;\n}\n",
  });
  assert.deepEqual(assertOnlySection(result, 4), [
    "- `apps/api/src/project/database/registration.ts`:同名 `apps/api/src/database/registration.ts`",
    "- `apps/api/src/project/widgets/tenant-purge.ts`:同名 `apps/api/src/database/tenant-purge.ts`;同匯出 `purgeTenant`(`apps/api/src/database/tenant-purge.ts`)",
    "- `apps/api/src/project/widgets/widget-utils.ts`:同匯出 `notFoundError`(`apps/api/src/forms/forms-error.ts`)",
    "- `apps/api/src/project/widgets/widgets-error.ts`:同匯出 `parseError`(`apps/api/src/lib/parse.ts`);同匯出 `sharedHelper`(`apps/api/src/forms/forms-error.ts`)",
    "- `packages/domain/src/project/form/keys.ts`:同名 `packages/domain/src/form/keys.ts`",
  ]);
});

test("不乾淨 4c:模組慣例常數與測試輔助檔對底座測試輔助的同名匯出不算;底座共用套件的常數、測試輔助撞正式程式碼的名稱、非測試輔助檔照列", async () => {
  const result = await verifyScenario("name-module-conventions", {
    // 模組慣例常數:底座各模組各一份,不算
    "apps/api/src/project/widgets/dto/widgets.input.ts":
      "export const DEFAULT_PAGE_SIZE = 20;\nexport const MAX_PAGE_SIZE = 50;\n",
    // AUDIT_ACTIONS 不算;REDACTED 底座在 packages/ 匯出(共用的那份):照列
    "apps/api/src/project/widgets/widget-keys.ts":
      "export const AUDIT_ACTIONS = {};\nexport const REDACTED = '***';\n",
    // 測試輔助檔對底座測試輔助(test-support、src/test/)同名:不算;撞底座正式程式碼的名稱:照列
    "apps/api/src/project/widgets/test-support/widgets-fixtures.ts":
      "export const PASSWORD = 'pw';\nexport const P = {};\nexport const parseError = () => 3;\n",
    "apps/admin/src/pages/project/widgets/widgets-test-support.ts":
      "export const setViewportWidth = () => {};\n",
    // 不是測試輔助檔卻匯出底座測試輔助的名稱:照列
    "apps/api/src/project/widgets/widget-auth.ts":
      "export const PASSWORD = 'pw';\n",
  });
  assert.deepEqual(assertOnlySection(result, 4), [
    "- `apps/api/src/project/widgets/test-support/widgets-fixtures.ts`:同匯出 `parseError`(`apps/api/src/lib/parse.ts`)",
    "- `apps/api/src/project/widgets/widget-auth.ts`:同匯出 `PASSWORD`(`apps/api/src/gizmos/test-support/fixtures.ts`)",
    "- `apps/api/src/project/widgets/widget-keys.ts`:同匯出 `REDACTED`(`packages/domain/src/redaction.ts`)",
  ]);
});

const GADGETS_PUBLIC = {
  "packages/project-config/src/project/public.ts":
    'export const projectPublic = { slug: "gadgets", brand: { name: "Gadgets Co" } };\n',
};

test("不乾淨 5:共用與混合路徑新增了專案字樣,第 5 節逐行列出;底座已有的詞、專案路徑與值行不算", async () => {
  const result = await verifyScenario("terms", {
    ...GADGETS_PUBLIC,
    "scripts/figma-audit/project/config.js":
      'export default { projectTerms: ["抽獎", "scanner"] };\n',
    "apps/db-migrator/seeds/project/modules.ts":
      "export const m = { nodes: [{ key: 'raffle.draw', name: '抽' }] };\n",
    "apps/api/src/project/raffle/raffle.schema.ts":
      "export const options = { collection: 'prize_pools' };\n",
    "packages/ui/src/promo.ts": [
      "// 抽獎活動",
      "export const key = 'GADGETS-admin-promo';",
      // useScanner 在底座已有:不是專案字樣
      "export const scanner = 'useScanner';",
      "export const path = '/raffle/prize_pools';",
      "",
    ].join("\n"),
    ".github/workflows/ci.yml": "name: Gadgets Co CI\n",
    // 專案路徑與值行檔不掃
    "apps/admin/src/pages/project/Raffle.tsx": "export const t = '抽獎';\n",
    "CLAUDE.md": "# gadgets\n\n規則\n",
  });
  assert.equal(result.exitCode, 1, result.stdout);
  assert.match(
    result.stdout,
    /專案字樣詞表:`gadgets`、`Gadgets Co`、`抽獎`、`raffle`、`prize`/,
  );
  assert.deepEqual(sectionLines(result.stdout, 1), [
    "- common A `packages/ui/src/promo.ts`",
  ]);
  assert.deepEqual(sectionLines(result.stdout, 5), [
    "- `.github/workflows/ci.yml` 第 1 行:`gadgets`、`Gadgets Co`",
    "- `packages/ui/src/promo.ts` 第 1 行:`抽獎`",
    "- `packages/ui/src/promo.ts` 第 2 行:`gadgets`",
    "- `packages/ui/src/promo.ts` 第 4 行:`raffle`、`prize`",
  ]);
  for (const number of [2, 3, 4, 6, 7]) {
    assert.deepEqual(
      sectionLines(result.stdout, number),
      [],
      `第 ${number} 節`,
    );
  }
});

test("不乾淨 5b:生成產物與依賴宣告裡的專案出口不掃;產物的共用來源、其他出口與依賴照列", async () => {
  const result = await verifyScenario("terms-generated", {
    ...GADGETS_PUBLIC,
    // 生成產物:由來源重產,不掃
    "apps/api/schema.gql":
      "type Query { ok: Boolean }\ntype GadgetsThing { id: ID }\n",
    "packages/graphql/src/generated/graphql.ts":
      "export type Query = {};\nexport type GadgetsThing = {};\n",
    // 產物的共用來源照掃(也是第 1 節的共用差異)
    "apps/api/src/orgs/thing.resolver.ts":
      "export const name = 'GadgetsThing';\n",
    "packages/domain/package.json": `${JSON.stringify(
      {
        name: "@repo/domain",
        exports: {
          "./project/gadgets": {
            import: "./dist/es/project/gadgets.js",
            require: "./dist/cjs/project/gadgets.cjs",
          },
          "./gadgets": "./dist/es/gadgets.js",
          "./project/promo": "./dist/es/gadgets-promo.js",
        },
        typesVersions: {
          "*": {
            "project/gadgets": ["./dist/es/project/gadgets.d.ts"],
            gadgets: ["./dist/es/gadgets.d.ts"],
          },
        },
        dependencies: { "gadgets-sdk": "1.0.0" },
      },
      null,
      2,
    )}\n`,
  });
  assert.equal(result.exitCode, 1, result.stdout);
  assert.deepEqual(sectionLines(result.stdout, 5), [
    "- `apps/api/src/orgs/thing.resolver.ts` 第 1 行:`gadgets`",
    "- `packages/domain/package.json` 第 8 行:`gadgets`",
    "- `packages/domain/package.json` 第 9 行:`gadgets`",
    "- `packages/domain/package.json` 第 16 行:`gadgets`",
    "- `packages/domain/package.json` 第 17 行:`gadgets`",
    "- `packages/domain/package.json` 第 22 行:`gadgets`",
  ]);
});

test("不乾淨 6:值行檔在值行以外與底座不同,第 6 節列出;範本值、標題與 README 開頭不算", async () => {
  const result = await verifyScenario("values", {
    ".env.example":
      "# 本機的應用名稱\nAPP_NAME=gadgets\n# APP_URL=http://gadgets.test\n",
    "CLAUDE.md": "# gadgets\n\n規則改了\n",
    "README.md": "# gadgets\n\n專案介紹\n\n另一段\n\n## 結構\n\n內容\n",
    "docker-compose.yml": "services: { mongo: {} }\n",
  });
  assert.deepEqual(assertOnlySection(result, 6), [
    "- `CLAUDE.md`:標題行以外與底座不同",
    "- `docker-compose.yml`:應與底座相同",
  ]);
});

test("不乾淨 7:專案 skill 名稱沒以 slug 開頭或沒成對,第 7 節列出;底座 skill 與專案的外部 skill 不算", async () => {
  const result = await verifyScenario("skills", {
    ...GADGETS_PUBLIC,
    ".claude/skills/gadgets-onboarding/SKILL.md": "# onboarding\n",
    ".agents/skills/gadgets-onboarding/SKILL.md": "# onboarding\n",
    ".claude/skills/helper/SKILL.md": "# helper\n",
    ".agents/skills/gadgets-report/SKILL.md": "# report\n",
    ".agents/skills/external-tool/SKILL.md": "# external\n",
    "skills-lock.json": `${JSON.stringify({ version: 1, skills: { "external-tool": {} } })}\n`,
    ".claude/skills/module-scaffold/SKILL.md": "# 底座 skill(common)\n",
  });
  assert.deepEqual(sectionLines(result.stdout, 7), [
    "- `gadgets-report`:缺 .claude/skills/gadgets-report/(兩邊成對)",
    "- `helper`:名稱須以 gadgets- 開頭",
    "- `helper`:缺 .agents/skills/helper/(兩邊成對)",
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

test("掃描工具:去註解保留字串;key 解析常數、樣板與 permissionKey;匯出名稱不含 default", () => {
  assert.equal(
    stripComments("const a = '// 不是註解'; // 註解\n/* 區塊\n註解 */b"),
    "const a = '// 不是註解'; \n\nb",
  );
  const constants = new Map([
    ["GROUP", "system"],
    ["USERS", "system.users"],
  ]);
  assert.equal(
    resolveKeyExpression("`${GROUP}.forms`", constants),
    "system.forms",
  );
  assert.equal(
    resolveKeyExpression('permissionKey(USERS, "create")', constants),
    "system.users.create",
  );
  assert.equal(resolveKeyExpression("`${missing}.x`", constants), null);
  assert.equal(resolveKeyExpression("node.key", constants), null);
  // 常數物件的成員以攤平的路徑查表
  assert.equal(
    resolveKeyExpression(
      "KEYS . viewPage",
      new Map([["KEYS.viewPage", "system.users.view-page"]]),
    ),
    "system.users.view-page",
  );
  assert.deepEqual(
    seedKeys(
      [
        "interface Shape { key: string; }",
        "export const a = { collection: COLLECTION, entries: [{ key: GROUP }] };",
        "export const b = { first: { collection: 'orgs', key: 'root' } };",
        "export const c = { entries: [{ key: unknownValue }] };",
        // 查不到值的 PascalCase 名稱 = 型別註記,略過;全大寫常數查不到照列;查得到值的照常解析
        "interface Role { key: RoleKey; name: string; }",
        "export const d = { entries: [{ key: MISSING_KEY }, { key: Known }] };",
      ].join("\n"),
      new Map([...constants, ["COLLECTION", "roles"], ["Known", "known"]]),
    ),
    {
      declared: [
        { collection: "roles", key: "system" },
        { collection: "?", key: "known" },
      ],
      unresolved: [
        { collection: "?", expression: "unknownValue", line: 4 },
        { collection: "?", expression: "MISSING_KEY", line: 6 },
      ],
      helperCalls: [],
    },
  );
  assert.deepEqual(
    [
      ...exportNames(
        [
          "export default function Page() {}",
          "export async function load() {}",
          "export type Props = {};",
          "export { a as renamed, type B, default as Named, c as default };",
          "// export const commented = 1;",
        ].join("\n"),
      ),
    ].sort(),
    ["B", "Named", "Props", "load", "renamed"].sort(),
  );
  // 一般檔不挖空字串:regex 與 JSX 文字裡的引號不會吃掉後面的匯出;測試檔的夾具字串不算匯出
  assert.deepEqual(
    [
      ...exportNames(
        "const re = /'/;\nexport function afterRegex() {}\nexport const A = () => <p>Don't</p>;\nexport function afterJsx() {}\n",
      ),
    ],
    ["afterRegex", "A", "afterJsx"],
  );
  assert.deepEqual(
    [
      ...exportNames(
        'const sample = "export function inString() {}";\nexport const real = 1;\n',
        { isTest: true },
      ),
    ],
    ["real"],
  );
  // 讀不懂的 package.json 照掃(不略過任何行)
  assert.deepEqual([...projectExportLines("{ not json")], []);
  // 與別的項目同一行就照掃(只略過整行都屬於專案出口的行)
  assert.deepEqual(
    [
      ...projectExportLines(
        '{"exports":{"./project/a":"./src/project/a.ts","./gadgets":"./src/gadgets.ts"}}\n',
      ),
    ],
    [],
  );
  assert.deepEqual(
    [
      ...projectExportLines(
        [
          "{",
          '  "exports": {',
          '    "./project/a": "./src/project/a.ts", "./gadgets": "./src/gadgets.ts"',
          "  }",
          "}",
        ].join("\n"),
      ),
    ],
    [],
  );
  assert.deepEqual(
    [
      ...projectExportLines(
        `${JSON.stringify(
          {
            exports: { "./project/a": "./dist/project/a.js", "./b": "./b.js" },
          },
          null,
          2,
        )}\n`,
      ),
    ],
    [3],
  );
});
