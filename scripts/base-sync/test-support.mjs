/**
 * base-sync 測試的共用工具:真 Git 隔離夾具與 gh 系統邊界的假實作。
 *
 * Git 一律真跑(各夾具自建 bare repo 當 GitHub 遠端)。repo 的 remote 設定只有真的 GitHub URL,
 * 不寫 insteadOf;工具的網路 fetch 經注入的 `fixtureFetch` 從 bare repo 真 fetch,測試自己的 push / fetch
 * 用 `netGit`(只在該次指令以 `-c` 轉址)。全域 Git 設定換成暫存檔,不受使用者的簽章、hooks 或 insteadOf 影響。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sampleGithub } from "../project-settings/test-support.mjs";

export const BASE_REPOSITORY = "acme/base";

/** 讓本測試行程(與它啟動的 git 子行程)只用暫存的全域 Git 設定。在任何夾具建立前呼叫一次。 */
export function isolateGitConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), "base-sync-git-"));
  const hooks = path.join(dir, "hooks");
  mkdirSync(hooks);
  const file = path.join(dir, "gitconfig");
  writeFileSync(
    file,
    [
      "[user]",
      "\tname = Fixture",
      "\temail = fixture@example.invalid",
      "[init]",
      "\tdefaultBranch = main",
      "[core]",
      "\tautocrlf = false",
      `\thooksPath = ${hooks.replaceAll("\\", "/")}`,
      "[commit]",
      "\tgpgsign = false",
      "[tag]",
      "\tgpgsign = false",
      "",
    ].join("\n"),
  );
  process.env.GIT_CONFIG_GLOBAL = file;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
}

/** 跑一個 git 指令,失敗直接丟錯(夾具建置用);回傳去掉尾端換行的 stdout。 */
export function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} 失敗:${result.stderr}`);
  }
  return result.stdout.replace(/\n$/, "");
}

/** 跑 git 但不丟錯,給「這個 ref 應該不存在」之類的斷言用。 */
export function tryGit(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout.replace(/\n$/, "") };
}

/** 寫入(或以 null 刪除)檔案後 commit,回傳完整 SHA。 */
export function commitFiles(cwd, files, message) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(cwd, file);
    if (content === null) {
      git(cwd, "rm", "-q", file);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    git(cwd, "add", file);
  }
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

export const httpsUrl = (repository) => `https://github.com/${repository}.git`;
export const sshUrl = (repository) => `git@github.com:${repository}.git`;

/**
 * 目前夾具的「GitHub 身分 → 本機 bare repo」對照(每次 createFixture 重設;測試依序執行)。
 * 只用在測試自己的網路操作與注入給工具的 fetch 邊界;不寫進任何 repo 的設定,
 * 所以工具核對的 remote 設定與實際 fetch 位址都是真的 GitHub 身分。
 */
const activeRemotes = new Map();

const transportFlags = () =>
  [...activeRemotes].flatMap(([repository, bare]) => {
    const key = `url.${bare.replaceAll("\\", "/")}.insteadOf`;
    return [
      "-c",
      `${key}=${httpsUrl(repository)}`,
      "-c",
      `${key}=${sshUrl(repository)}`,
    ];
  });

/** 測試自己的網路操作(clone / push / fetch GitHub URL):只在這次指令把 URL 轉到夾具的 bare repo。 */
export const netGit = (cwd, ...args) => git(cwd, ...transportFlags(), ...args);

/**
 * 注入給工具的網路 fetch 邊界:同簽名,改從夾具的 bare repo 真的 fetch(Git 照常驗證物件與 ref)。
 * 只依工具核對後的 `repository` 對應來源。
 */
export function fixtureFetch({ root, repository, refspec }) {
  const bare = activeRemotes.get(repository);
  if (bare === undefined) return { status: 128 };
  const result = spawnSync(
    "git",
    ["fetch", "--no-tags", "--no-write-fetch-head", bare, refspec],
    { cwd: root, encoding: "utf8" },
  );
  return { status: result.status };
}

function cloneMapped(root, repository, _bare, name) {
  const dir = path.join(root, name);
  netGit(root, "clone", "-q", httpsUrl(repository), dir);
  return dir;
}

const githubJson = (repository) =>
  `${JSON.stringify({ ...sampleGithub(), expectedRepository: repository }, null, 2)}\n`;

const packageJson = (name, wowgoBase) =>
  `${JSON.stringify({ name, private: true, ...(wowgoBase ? { wowgoBase } : {}) }, null, 2)}\n`;

/** 底座 v0.1.0 的內容:各維護歸屬各放一個代表檔(路徑照真實 repo)。 */
const BASE_V1_FILES = {
  "package.json": packageJson("wowgo-base"),
  "deploy/project/github.json": githubJson(BASE_REPOSITORY),
  "packages/ui/src/button.ts": "export const label = 'base-v0';\n",
  "packages/ui/src/tokens.ts": "export const spacing = 8;\n",
  "packages/project-config/src/project/public.ts":
    "export const brand = 'neutral';\n",
  "apps/db-migrator/seeds/project/settings.ts":
    "export const orgName = 'Neutral';\n",
  "apps/admin/src/app/module-pages.tsx": "export const pages = ['base'];\n",
  // 已發布的 migration / 快照,以及專案擁有的前台文案與 favicon、可含專案文案的 admin 語系
  "apps/db-migrator/migrations/base/20260901120000_data_old.js":
    "module.exports = { up: async () => {} };\n",
  "apps/db-migrator/seeds/base/revisions/roles.r1.json": '{"roles":[]}\n',
  "packages/i18n/messages/en/front.json": '{"home":"Neutral"}\n',
  "packages/i18n/messages/en/admin.json": '{"nav":"Admin"}\n',
  "apps/admin/public/favicon.ico": "neutral-icon\n",
};

/**
 * v0.2.0 的差異(維護歸屬的案例表):共用 UI / API / seed、專案值(專案沒改過,會被 Git 自動套入)、
 * 新增與改寫已發布來源、聚合產物、語系、固定組裝、未知。
 */
export const BASE_V2_CHANGES = {
  "packages/ui/src/button.ts": "export const label = 'base-v1';\n",
  "apps/api/src/auth/session.ts": "export const sessionTtl = 3600;\n",
  "apps/db-migrator/seeds/base/roles.ts": "export const roles = ['admin'];\n",
  "apps/db-migrator/seeds/project/settings.ts":
    "export const orgName = 'Neutral Org';\n",
  "apps/db-migrator/migrations/base/20261001120000_data_sample.js":
    "module.exports = { up: async () => {} };\n",
  "apps/db-migrator/migrations/base/20260901120000_data_old.js":
    "module.exports = { up: async () => { /* rewritten */ } };\n",
  "apps/db-migrator/seeds/base/revisions/roles.r2.json":
    '{"roles":["admin"]}\n',
  "apps/db-migrator/seeds/base/revisions/roles.r1.json": '{"roles":["x"]}\n',
  "apps/db-migrator/migrations/project/20261001120000_data_project.js":
    "module.exports = { up: async () => {} };\n",
  "packages/i18n/messages/en/front.json": '{"home":"Neutral 2"}\n',
  "packages/i18n/messages/en/admin.json": '{"nav":"Admin 2"}\n',
  "apps/admin/public/favicon.ico": "neutral-icon-2\n",
  "apps/e2e/docker-compose.yml": "services: {}\n",
  "apps/api/schema.gql": "type Query { ok: Boolean }\n",
  "packages/graphql/src/generated/graphql.ts": "export type Query = {};\n",
  "apps/admin/src/app/module-pages.tsx":
    "export const pages = ['base', 'audit'];\n",
  "misc/notes.txt": "unclassified\n",
};

export const EXPECTED_V2_CATEGORIES = {
  "packages/ui/src/button.ts": "common",
  "apps/api/src/auth/session.ts": "common",
  "apps/db-migrator/seeds/base/roles.ts": "common",
  "apps/db-migrator/seeds/project/settings.ts": "project",
  // 不可變目錄:新增(A)依歸屬分類,改寫既有檔才是 published-data
  "apps/db-migrator/migrations/base/20261001120000_data_sample.js": "common",
  "apps/db-migrator/migrations/base/20260901120000_data_old.js":
    "published-data",
  "apps/db-migrator/seeds/base/revisions/roles.r2.json": "common",
  "apps/db-migrator/seeds/base/revisions/roles.r1.json": "published-data",
  "apps/db-migrator/migrations/project/20261001120000_data_project.js":
    "project",
  "packages/i18n/messages/en/front.json": "project",
  "packages/i18n/messages/en/admin.json": "mixed",
  "apps/admin/public/favicon.ico": "project",
  "apps/e2e/docker-compose.yml": "mixed",
  "apps/api/schema.gql": "mixed",
  "packages/graphql/src/generated/graphql.ts": "mixed",
  "apps/admin/src/app/module-pages.tsx": "common",
  "misc/notes.txt": "unknown",
};

/**
 * `widgets` 的專案內容:新增業務 API、替換治理頁,並改了與 v0.2.0 衝突的 button.ts。
 * 品牌值另在 public.ts(每個專案不同)。
 */
export const WIDGETS_SOURCES = {
  "packages/ui/src/button.ts": "export const label = 'widgets';\n",
  "apps/api/src/project/orders/orders.module.ts":
    "export const ordersModule = 'orders';\n",
  "apps/admin/src/app/project/page-replacements.ts":
    "export const replacements = { users: 'CustomUsersPage' };\n",
  "apps/admin/src/pages/project/CustomUsersPage/CustomUsersPage.tsx":
    "export const CustomUsersPage = 'custom';\n",
};

/**
 * 建一組隔離的底座與引用專案:
 * - 底座 `acme/base`:b0(annotated tag v0.1.0)→ b1(annotated tag v0.2.0,有正式 Release)
 * - 引用專案從 b0 分出、只帶專案值的 p1;`widgets` 也改了 button.ts(與 v0.2.0 衝突),`gadgets` 沒改
 * - 引用專案自己有同名 tag v0.2.0(指向 p1),用來驗證不被底座 tag 覆蓋
 * 回傳各 repo 路徑與 commit;`worktreeRoot` 是空的暫存目錄。
 */
export function createFixture({ projects = ["widgets"] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "base-sync-fixture-"));
  const baseBare = path.join(root, "remotes/base.git");
  git(root, "init", "-q", "--bare", baseBare);
  activeRemotes.clear();
  activeRemotes.set(BASE_REPOSITORY, baseBare);

  const baseSrc = path.join(root, "base-src");
  mkdirSync(baseSrc);
  git(baseSrc, "init", "-q");
  git(baseSrc, "remote", "add", "origin", baseBare);
  const b0 = commitFiles(baseSrc, BASE_V1_FILES, "base v0.1.0");
  git(baseSrc, "tag", "-a", "v0.1.0", "-m", "v0.1.0");
  git(baseSrc, "push", "-q", "origin", "main", "refs/tags/v0.1.0");

  const projectInfo = {};
  for (const name of projects) {
    const repository = `acme/${name}`;
    const bare = path.join(root, `remotes/${name}.git`);
    git(root, "init", "-q", "--bare", bare);
    activeRemotes.set(repository, bare);
    git(baseSrc, "push", "-q", bare, `${b0}:refs/heads/main`);
    const dir = cloneMapped(root, repository, bare, name);
    git(dir, "remote", "add", "upstream", httpsUrl(BASE_REPOSITORY));
    git(dir, "config", "remote.upstream.tagOpt", "--no-tags");
    const p1 = commitFiles(
      dir,
      {
        "package.json": packageJson(name, {
          repository: httpsUrl(BASE_REPOSITORY),
          tag: "v0.1.0",
          commit: b0,
        }),
        "deploy/project/github.json": githubJson(repository),
        "packages/project-config/src/project/public.ts": `export const brand = '${name}';\n`,
        ...(name === "widgets" ? WIDGETS_SOURCES : {}),
      },
      `${name}: project values`,
    );
    netGit(dir, "push", "-q", "origin", "main");
    git(dir, "tag", "v0.2.0", p1);
    projectInfo[name] = { repository, root: dir, bare, p1 };
  }

  const b1 = commitFiles(baseSrc, BASE_V2_CHANGES, "base v0.2.0");
  git(baseSrc, "tag", "-a", "v0.2.0", "-m", "v0.2.0");
  git(baseSrc, "push", "-q", "origin", "main", "refs/tags/v0.2.0");

  const worktreeRoot = path.join(root, "worktrees");
  mkdirSync(worktreeRoot);
  return {
    root,
    worktreeRoot,
    base: { repository: BASE_REPOSITORY, bare: baseBare, src: baseSrc, b0, b1 },
    projects: projectInfo,
  };
}

/** 從夾具的底座遠端 clone 一份「底座本機 repo」(contribute 的 --base),origin 是 GitHub 身分。 */
export function cloneBase(fixture) {
  return cloneMapped(
    fixture.root,
    BASE_REPOSITORY,
    fixture.base.bare,
    "base-local",
  );
}

/** 另一份專案 checkout(另一位開發者或 agent),origin 是 GitHub 身分。 */
export function cloneProject(fixture, name, dirName) {
  const project = fixture.projects[name];
  return cloneMapped(fixture.root, project.repository, project.bare, dirName);
}

/** 從另一份 clone 推一個新 commit 到專案遠端的 main,模擬等待期間 main 前進。 */
export function advanceRemoteMain(fixture, name) {
  const project = fixture.projects[name];
  const dir = cloneMapped(
    fixture.root,
    project.repository,
    project.bare,
    `${name}-other`,
  );
  const commit = commitFiles(
    dir,
    { "apps/front/src/home.tsx": "export const home = 1;\n" },
    "feature landed on main",
  );
  netGit(dir, "push", "-q", "origin", "main");
  return commit;
}

/**
 * gh 系統邊界的假實作。只回答 base-sync 會用到的兩種查詢,其他呼叫一律失敗:
 *   gh release view <tag> --repo <owner/repo> --json …
 *   gh pr list --repo <owner/repo> --head <branch> … --json …
 * `releases` 以 `<owner/repo>#<tag>` 為鍵;`pulls` 以 `<owner/repo>#<branch>` 為鍵。
 * 呼叫參數記在 `calls`,測試據此確認每次都明示 `--repo`。
 */
export function createFakeGh({ releases = {}, pulls = {} } = {}) {
  const calls = [];
  const valueOf = (args, name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  function runExternal(command, args) {
    calls.push({ command, args: [...args] });
    if (command !== "gh") {
      return { status: 127, stdout: "", stderr: `unexpected ${command}` };
    }
    const repo = valueOf(args, "--repo");
    if (args[0] === "release" && args[1] === "view") {
      const release = releases[`${repo}#${args[2]}`];
      if (release === undefined) {
        return { status: 1, stdout: "", stderr: "release not found" };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          tagName: args[2],
          isDraft: false,
          isPrerelease: false,
          url: `https://github.com/${repo}/releases/tag/${args[2]}`,
          ...release,
        }),
        stderr: "",
      };
    }
    if (args[0] === "pr" && args[1] === "list") {
      const head = valueOf(args, "--head");
      return {
        status: 0,
        stdout: JSON.stringify(pulls[`${repo}#${head}`] ?? []),
        stderr: "",
      };
    }
    return { status: 1, stdout: "", stderr: "unsupported gh call" };
  }
  return { runExternal, calls };
}

/** v0.2.0 有正式 Release 的預設 gh。 */
export function publishedReleaseGh(extra = {}) {
  return createFakeGh({
    releases: { [`${BASE_REPOSITORY}#v0.2.0`]: {}, ...extra.releases },
    pulls: extra.pulls,
  });
}
