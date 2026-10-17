/**
 * base-sync 的驗收測試(操作正本:docs/deployment.md「底座首次接軌與版本升級」)。
 * Git 全部真跑在隔離夾具;只有 gh 換成假實作(系統邊界)。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { runBaseSync } from "./base-sync.mjs";
import {
  BASE_REPOSITORY,
  BASE_V2_CHANGES,
  EXPECTED_V2_CATEGORIES,
  WIDGETS_SOURCES,
  advanceRemoteMain,
  cloneBase,
  cloneProject,
  commitFiles,
  createFakeGh,
  createFixture,
  fixtureFetch,
  git,
  httpsUrl,
  isolateGitConfig,
  netGit,
  publishedReleaseGh,
  sshUrl,
  tryGit,
} from "./test-support.mjs";

before(isolateGitConfig);

async function run(args, runExternal) {
  const result = await runBaseSync(args, {
    runExternal,
    fetchRemote: fixtureFetch,
  });
  return {
    ...result,
    json: result.exitCode === 0 ? JSON.parse(result.stdout) : null,
  };
}

/** 失敗協定:非零退出、stdout 沒有輸出、stderr 有說明。 */
function assertRejected(result, pattern) {
  assert.notEqual(result.exitCode, 0, result.stdout);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, pattern);
}

const upgradeArgs = (fixture, names, tag = "v0.2.0") => [
  "upgrade",
  ...names.flatMap((name) => ["--project", fixture.projects[name].root]),
  "--tag",
  tag,
  "--worktree-root",
  fixture.worktreeRoot,
];

const categories = (files) =>
  Object.fromEntries(files.map((file) => [file.path, file.category]));

const remoteHeads = (bare) =>
  git(bare, "for-each-ref", "--format=%(refname)", "refs/heads");

/** MERGE_HEAD 可能存 tag object 或 commit,只比較它解析到的 commit。 */
const mergeHeadCommit = (worktree) =>
  git(worktree, "rev-parse", "MERGE_HEAD^{commit}");

test("inspect:逐檔列出完整差異與維護歸屬,包含 Git 會自動套入的專案值", async () => {
  const fixture = createFixture();
  const { root } = fixture.projects.widgets;
  // inspect 唯讀不 fetch:比較的目標版本由安排階段先取進本機
  netGit(root, "fetch", "-q", "upstream", "main");
  const result = await run(
    [
      "inspect",
      "--project",
      root,
      "--from",
      fixture.base.b0,
      "--to",
      fixture.base.b1,
    ],
    createFakeGh().runExternal,
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.json.project.repository, "acme/widgets");
  assert.deepEqual(result.json.adopted, {
    repository: BASE_REPOSITORY,
    tag: "v0.1.0",
    commit: fixture.base.b0,
  });
  assert.deepEqual(categories(result.json.files), EXPECTED_V2_CATEGORIES);
});

test("upgrade:兩個專案各自從 origin/main 建工作樹做正常三方 merge,保留未提交結果;衝突與自動套入的專案值都回報", async () => {
  const fixture = createFixture({ projects: ["widgets", "gadgets"] });
  // gadgets 把 GitHub HTTPS 改寫成同一 repo 的 SSH:身分相同,接受
  git(
    fixture.projects.gadgets.root,
    "config",
    "url.git@github.com:.insteadOf",
    "https://github.com/",
  );
  assert.equal(
    git(fixture.projects.gadgets.root, "remote", "get-url", "upstream"),
    sshUrl(BASE_REPOSITORY),
  );
  const gh = publishedReleaseGh();
  const result = await run(
    upgradeArgs(fixture, ["widgets", "gadgets"]),
    gh.runExternal,
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.json.base.repository, BASE_REPOSITORY);
  assert.equal(result.json.base.commit, fixture.base.b1);

  const [widgets, gadgets] = result.json.projects;
  assert.equal(widgets.repository, "acme/widgets");
  assert.equal(gadgets.repository, "acme/gadgets");
  assert.deepEqual(widgets.conflicts, ["packages/ui/src/button.ts"]);
  assert.deepEqual(gadgets.conflicts, []);

  for (const [name, report] of [
    ["widgets", widgets],
    ["gadgets", gadgets],
  ]) {
    const { root, bare, p1 } = fixture.projects[name];
    assert.equal(report.state, "prepared");
    assert.ok(report.worktree.startsWith(fixture.worktreeRoot));
    assert.equal(
      git(report.worktree, "branch", "--show-current"),
      report.branch,
    );
    // 正常 merge 尚未提交:HEAD 仍是 origin/main,MERGE_HEAD 解析到 tag 的 commit(不是 squash / cherry-pick)
    assert.equal(git(report.worktree, "rev-parse", "HEAD"), p1);
    assert.equal(mergeHeadCommit(report.worktree), fixture.base.b1);
    // 底座 tag 存在獨立 ref,專案自己的同名 tag 不被覆蓋
    assert.equal(
      git(root, "cat-file", "-t", "refs/base/releases/v0.2.0"),
      "tag",
    );
    assert.equal(
      git(root, "rev-parse", "refs/base/releases/v0.2.0^{commit}"),
      fixture.base.b1,
    );
    assert.equal(git(root, "rev-parse", "refs/tags/v0.2.0"), p1);
    // Git 沒報衝突、但被自動套入的專案值也要列出
    const autoApplied = report.files.find(
      (file) => file.path === "apps/db-migrator/seeds/project/settings.ts",
    );
    assert.equal(autoApplied?.category, "project");
    assert.deepEqual(categories(report.files), EXPECTED_V2_CATEGORIES);
    // 不推送、不動遠端
    assert.equal(remoteHeads(bare), "refs/heads/main");
  }

  // 每個 gh 呼叫都明示 --repo owner/repo
  assert.ok(gh.calls.length > 0);
  for (const call of gh.calls) {
    assert.equal(call.command, "gh");
    const index = call.args.indexOf("--repo");
    assert.notEqual(index, -1, call.args.join(" "));
    assert.match(call.args[index + 1], /^acme\/[\w.-]+$/);
  }
});

test("upgrade 重跑同版本:回報既有分支與 PR,不重做 merge、不覆蓋手動整合(未提交與已提交皆同)", async () => {
  const fixture = createFixture();
  const first = await run(
    upgradeArgs(fixture, ["widgets"]),
    publishedReleaseGh().runExternal,
  );
  assert.equal(first.exitCode, 0, first.stderr);
  const { worktree, branch } = first.json.projects[0];

  // agent 手動整合衝突並 stage
  const conflicted = path.join(worktree, "packages/ui/src/button.ts");
  writeFileSync(conflicted, "export const label = 'manual';\n");
  git(worktree, "add", "packages/ui/src/button.ts");

  const pull = {
    number: 7,
    url: "https://github.com/acme/widgets/pull/7",
    isDraft: true,
  };
  const gh = publishedReleaseGh({
    pulls: { [`acme/widgets#${branch}`]: [pull] },
  });
  const second = await run(upgradeArgs(fixture, ["widgets"]), gh.runExternal);
  assert.equal(second.exitCode, 0, second.stderr);
  const report = second.json.projects[0];
  assert.equal(report.state, "existing");
  assert.equal(report.branch, branch);
  assert.equal(report.worktree, worktree);
  assert.deepEqual(report.conflicts, []);
  assert.equal(report.pullRequest?.number, 7);
  assert.equal(
    readFileSync(conflicted, "utf8"),
    "export const label = 'manual';\n",
  );
  assert.equal(mergeHeadCommit(worktree), fixture.base.b1);

  // 提交 merge 之後再重跑:仍認得是同一次升級,HEAD 不變
  git(worktree, "commit", "-q", "--no-edit");
  const merged = git(worktree, "rev-parse", "HEAD");
  const third = await run(upgradeArgs(fixture, ["widgets"]), gh.runExternal);
  assert.equal(third.exitCode, 0, third.stderr);
  assert.equal(third.json.projects[0].state, "existing");
  assert.equal(git(worktree, "rev-parse", "HEAD"), merged);
  assert.equal(
    git(worktree, "rev-list", "--parents", "-n", "1", "HEAD"),
    `${merged} ${fixture.projects.widgets.p1} ${fixture.base.b1}`,
  );
});

test("upgrade 重跑時 origin/main 已前進:拒絕並要求依 deployment 重建,不 reset / rebase 既有工作樹", async () => {
  const fixture = createFixture();
  const first = await run(
    upgradeArgs(fixture, ["widgets"]),
    publishedReleaseGh().runExternal,
  );
  assert.equal(first.exitCode, 0, first.stderr);
  const { worktree } = first.json.projects[0];
  const status = git(worktree, "status", "--porcelain");

  advanceRemoteMain(fixture, "widgets");
  const rerun = await run(
    upgradeArgs(fixture, ["widgets"]),
    publishedReleaseGh().runExternal,
  );
  assertRejected(rerun, /重建/);
  assert.equal(git(worktree, "rev-parse", "HEAD"), fixture.projects.widgets.p1);
  assert.equal(mergeHeadCommit(worktree), fixture.base.b1);
  assert.equal(git(worktree, "status", "--porcelain"), status);
});

test("upgrade 重跑時底座同名 tag 已改指不同內容:拒絕,保留原本取得的底座 ref", async () => {
  const fixture = createFixture();
  const first = await run(
    upgradeArgs(fixture, ["widgets"]),
    publishedReleaseGh().runExternal,
  );
  assert.equal(first.exitCode, 0, first.stderr);
  const { root } = fixture.projects.widgets;
  const savedTag = git(root, "rev-parse", "refs/base/releases/v0.2.0");

  const { src } = fixture.base;
  commitFiles(
    src,
    { "packages/ui/src/button.ts": "export const label = 'moved';\n" },
    "retag",
  );
  git(src, "tag", "-f", "-a", "v0.2.0", "-m", "v0.2.0 moved");
  git(src, "push", "-q", "-f", "origin", "refs/tags/v0.2.0");

  const rerun = await run(
    upgradeArgs(fixture, ["widgets"]),
    publishedReleaseGh().runExternal,
  );
  assertRejected(rerun, /v0\.2\.0/);
  assert.equal(git(root, "rev-parse", "refs/base/releases/v0.2.0"), savedTag);
});

test("upgrade 來源核對不過一律拒絕:不建工作樹、不留分支,輸出不帶 credential", async () => {
  const cases = [
    {
      name: "Release 是 draft",
      gh: () =>
        publishedReleaseGh({
          releases: { [`${BASE_REPOSITORY}#v0.2.0`]: { isDraft: true } },
        }),
      pattern: /Release/,
    },
    {
      name: "Release 是 prerelease",
      gh: () =>
        publishedReleaseGh({
          releases: { [`${BASE_REPOSITORY}#v0.2.0`]: { isPrerelease: true } },
        }),
      pattern: /Release/,
    },
    {
      name: "沒有 Release",
      gh: () => createFakeGh(),
      pattern: /Release/,
    },
    {
      name: "lightweight tag",
      tag: "v0.2.1",
      arrange: (fixture) => {
        git(fixture.base.src, "tag", "v0.2.1", fixture.base.b1);
        git(fixture.base.src, "push", "-q", "origin", "refs/tags/v0.2.1");
      },
      gh: () =>
        publishedReleaseGh({ releases: { [`${BASE_REPOSITORY}#v0.2.1`]: {} } }),
      pattern: /annotated/,
    },
    {
      name: "origin URL 帶 credential",
      arrange: (fixture) =>
        git(
          fixture.projects.widgets.root,
          "remote",
          "set-url",
          "origin",
          "https://x-access-token:SECRET-TOKEN-123@github.com/acme/widgets.git",
        ),
      gh: () => publishedReleaseGh(),
      pattern: /origin/,
    },
    {
      name: "origin 不是 expectedRepository",
      arrange: (fixture) =>
        git(
          fixture.projects.widgets.root,
          "remote",
          "set-url",
          "origin",
          httpsUrl("evil/widgets"),
        ),
      gh: () => publishedReleaseGh(),
      pattern: /origin/,
    },
    {
      name: "upstream 不是 wowgoBase.repository",
      arrange: (fixture) =>
        git(
          fixture.projects.widgets.root,
          "remote",
          "set-url",
          "upstream",
          httpsUrl("acme/other"),
        ),
      gh: () => publishedReleaseGh(),
      pattern: /upstream/,
    },
    {
      // 設定值是官方 URL,實際 fetch 卻被改寫到本機的偽造 repo(含同名 annotated tag)
      name: "upstream 以 insteadOf 改寫到本機路徑",
      arrange: (fixture) => {
        const forged = path.join(fixture.root, "remotes/forged.git");
        git(fixture.root, "clone", "-q", "--bare", fixture.base.bare, forged);
        git(
          fixture.projects.widgets.root,
          "config",
          `url.${forged.replaceAll("\\", "/")}.insteadOf`,
          httpsUrl(BASE_REPOSITORY),
        );
      },
      gh: () => publishedReleaseGh(),
      pattern: /upstream.*改寫/,
    },
    {
      name: "upstream 以 insteadOf 改寫到別的 GitHub repo",
      arrange: (fixture) =>
        git(
          fixture.projects.widgets.root,
          "config",
          `url.${httpsUrl("evil/base")}.insteadOf`,
          httpsUrl(BASE_REPOSITORY),
        ),
      gh: () => publishedReleaseGh(),
      pattern: /upstream.*改寫/,
    },
    {
      name: "origin 以 insteadOf 改寫到本機路徑",
      arrange: (fixture) =>
        git(
          fixture.projects.widgets.root,
          "config",
          `url.${fixture.projects.widgets.bare.replaceAll("\\", "/")}.insteadOf`,
          httpsUrl("acme/widgets"),
        ),
      gh: () => publishedReleaseGh(),
      pattern: /origin.*改寫/,
    },
    {
      name: "wowgoBase.commit 不是專案祖先",
      arrange: (fixture) => {
        const { root } = fixture.projects.widgets;
        const manifest = JSON.parse(
          readFileSync(path.join(root, "package.json"), "utf8"),
        );
        manifest.wowgoBase.commit = fixture.base.b1;
        commitFiles(
          root,
          { "package.json": `${JSON.stringify(manifest, null, 2)}\n` },
          "bad adoption",
        );
        netGit(root, "push", "-q", "origin", "main");
      },
      gh: () => publishedReleaseGh(),
      pattern: /wowgoBase/,
    },
  ];
  for (const scenario of cases) {
    const fixture = createFixture();
    scenario.arrange?.(fixture);
    const { root } = fixture.projects.widgets;
    const branchesBefore = git(
      root,
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
    );
    const configBefore = git(root, "config", "--local", "--list");
    const tag = scenario.tag ?? "v0.2.0";
    const result = await run(
      upgradeArgs(fixture, ["widgets"], tag),
      scenario.gh().runExternal,
    );
    assertRejected(result, scenario.pattern);
    assert.doesNotMatch(result.stderr, /SECRET-TOKEN-123/, scenario.name);
    assert.doesNotMatch(result.stderr, /github\.com|forged/, scenario.name);
    // 拒絕發生在取得目標 tag、建分支或工作樹之前;使用者的 repo 設定不變
    assert.deepEqual(readdirSync(fixture.worktreeRoot), [], scenario.name);
    assert.equal(
      git(root, "for-each-ref", "--format=%(refname)", "refs/heads"),
      branchesBefore,
      scenario.name,
    );
    assert.notEqual(
      tryGit(root, "rev-parse", "--verify", `refs/base/releases/${tag}`).status,
      0,
      scenario.name,
    );
    assert.equal(
      git(root, "config", "--local", "--list"),
      configBefore,
      scenario.name,
    );
  }
});

test("contribute:以來源 commit 與 parent 的精確差異,從底座最新 origin/main 準備 common-only 分支,不動底座本機 repo 與遠端", async () => {
  const fixture = createFixture();
  const { root, p1 } = fixture.projects.widgets;
  const commit = commitFiles(
    root,
    {
      "packages/ui/src/spacing.ts": "export const gap = 4;\n",
      "packages/ui/src/tokens.ts": "export const spacing = 12;\n",
    },
    "ui: shared spacing fix",
  );
  const baseLocal = cloneBase(fixture);
  // 底座本機 repo 停在舊的 b0,證明分支是從「最新」origin/main 起
  git(baseLocal, "checkout", "-q", "--detach", fixture.base.b0);

  const result = await run(
    [
      "contribute",
      "--project",
      root,
      "--commit",
      commit,
      "--base",
      baseLocal,
      "--worktree-root",
      fixture.worktreeRoot,
    ],
    createFakeGh().runExternal,
  );
  assert.equal(result.exitCode, 0, result.stderr);
  const report = result.json;
  assert.deepEqual(report.source, {
    repository: "acme/widgets",
    commit,
    parent: p1,
  });
  assert.equal(report.base.repository, BASE_REPOSITORY);
  assert.equal(report.base.mainCommit, fixture.base.b1);
  assert.deepEqual(categories(report.files), {
    "packages/ui/src/spacing.ts": "common",
    "packages/ui/src/tokens.ts": "common",
  });
  assert.equal(git(report.worktree, "branch", "--show-current"), report.branch);
  assert.equal(git(report.worktree, "rev-parse", "HEAD"), fixture.base.b1);
  // 精確差異已 stage、未提交,由 agent 審查後提交
  assert.equal(
    git(report.worktree, "diff", "--cached", "--binary"),
    git(root, "diff", "--binary", p1, commit),
  );
  assert.equal(git(baseLocal, "rev-parse", "HEAD"), fixture.base.b0);
  assert.equal(git(baseLocal, "status", "--porcelain"), "");
  assert.equal(remoteHeads(fixture.base.bare), "refs/heads/main");

  const contributeArgs = (source) => [
    "contribute",
    "--project",
    root,
    "--commit",
    source,
    "--base",
    baseLocal,
    "--worktree-root",
    fixture.worktreeRoot,
  ];
  // 重跑:準備後的人工審查(已提交 + 未 stage 的修改)保留,回報既有狀態,不重套
  const { worktree } = report;
  const spacing = path.join(worktree, "packages/ui/src/spacing.ts");
  git(worktree, "commit", "-q", "-m", "review: spacing");
  writeFileSync(spacing, "export const gap = 6;\n");
  const rerun = await run(contributeArgs(commit), createFakeGh().runExternal);
  assert.equal(rerun.exitCode, 0, rerun.stderr);
  assert.equal(rerun.json.state, "existing");
  assert.equal(readFileSync(spacing, "utf8"), "export const gap = 6;\n");

  // HEAD 被移到記錄的底座 main 之前:不接手
  git(worktree, "reset", "-q", "--hard", fixture.base.b0);
  assertRejected(
    await run(contributeArgs(commit), createFakeGh().runExternal),
    /HEAD/,
  );
  assert.equal(git(worktree, "rev-parse", "HEAD"), fixture.base.b0);

  // 中斷的準備(分支在、沒有完成記錄):不自動重套
  const next = commitFiles(
    root,
    { "packages/ui/src/gap.ts": "export const gapScale = 2;\n" },
    "ui: gap scale",
  );
  git(
    baseLocal,
    "branch",
    `codex/base-contribute-${next.slice(0, 12)}`,
    fixture.base.b1,
  );
  assertRejected(
    await run(contributeArgs(next), createFakeGh().runExternal),
    /沒有完成準備/,
  );
  assert.equal(readdirSync(fixture.worktreeRoot).length, 1);
});

test("contribute 拒絕含專案路徑、merge commit 或非完整 SHA 的來源,不建工作樹", async () => {
  const fixture = createFixture();
  const { root, p1 } = fixture.projects.widgets;
  const baseLocal = cloneBase(fixture);
  const mixed = commitFiles(
    root,
    {
      "packages/ui/src/spacing.ts": "export const gap = 4;\n",
      "packages/project-config/src/project/public.ts":
        "export const brand = 'widgets2';\n",
    },
    "mixed change",
  );
  git(root, "checkout", "-q", "-b", "side", p1);
  commitFiles(
    root,
    { "packages/ui/src/side.ts": "export const side = 1;\n" },
    "side",
  );
  git(root, "checkout", "-q", "main");
  git(root, "merge", "-q", "--no-ff", "--no-edit", "side");
  const mergeCommit = git(root, "rev-parse", "HEAD");

  for (const [commit, pattern] of [
    [mixed, /packages\/project-config\/src\/project\/public\.ts/],
    [mergeCommit, /parent/],
    [mixed.slice(0, 7), /commit/],
  ]) {
    const result = await run(
      [
        "contribute",
        "--project",
        root,
        "--commit",
        commit,
        "--base",
        baseLocal,
        "--worktree-root",
        fixture.worktreeRoot,
      ],
      createFakeGh().runExternal,
    );
    assertRejected(result, pattern);
    assert.deepEqual(readdirSync(fixture.worktreeRoot), []);
    assert.equal(
      tryGit(baseLocal, "worktree", "list", "--porcelain").stdout.split("\n\n")
        .length,
      1,
    );
  }
});

const contributeWith = (fixture, baseLocal, commit, accepted = []) => [
  "contribute",
  "--project",
  fixture.projects.widgets.root,
  "--commit",
  commit,
  "--base",
  baseLocal,
  "--worktree-root",
  fixture.worktreeRoot,
  ...accepted.flatMap((file) => ["--accept-mixed", file]),
];

/** 被拒絕時不建工作樹、不留 contribution 分支。 */
function assertNothingPrepared(fixture, baseLocal) {
  assert.deepEqual(readdirSync(fixture.worktreeRoot), []);
  assert.equal(
    tryGit(baseLocal, "worktree", "list", "--porcelain").stdout.split("\n\n")
      .length,
    1,
  );
}

test("contribute --accept-mixed:明列只含底座段落的混合檔才接受,差異列進報告供審查", async () => {
  const fixture = createFixture();
  const { root, p1 } = fixture.projects.widgets;
  const baseLocal = cloneBase(fixture);
  const commit = commitFiles(
    root,
    {
      "packages/ui/src/spacing.ts": "export const gap = 4;\n",
      "docs/x.md": "# 共用做法\n",
    },
    "ui: spacing with docs",
  );

  // 沒有明列:混合檔照舊拒絕
  assertRejected(
    await run(
      contributeWith(fixture, baseLocal, commit),
      createFakeGh().runExternal,
    ),
    /docs\/x\.md\(mixed\)/,
  );
  assertNothingPrepared(fixture, baseLocal);

  const result = await run(
    contributeWith(fixture, baseLocal, commit, ["docs/x.md"]),
    createFakeGh().runExternal,
  );
  assert.equal(result.exitCode, 0, result.stderr);
  const report = result.json;
  assert.deepEqual(categories(report.files), {
    "docs/x.md": "mixed",
    "packages/ui/src/spacing.ts": "common",
  });
  assert.equal(report.mixedReview.note, "混合檔:只含底座段落,請審查");
  assert.deepEqual(
    report.mixedReview.files.map(({ path: file, status }) => [file, status]),
    [["docs/x.md", "A"]],
  );
  assert.equal(
    report.mixedReview.files[0].diff,
    git(
      root,
      "diff",
      "--full-index",
      "--no-renames",
      p1,
      commit,
      "--",
      "docs/x.md",
    ),
  );
  // 明列的混合檔與 common 一起 stage
  assert.equal(
    git(report.worktree, "diff", "--cached", "--binary"),
    git(root, "diff", "--binary", p1, commit),
  );
});

test("contribute --accept-mixed:未明列的混合檔、未知路徑、已發布資料仍拒絕", async () => {
  const fixture = createFixture();
  const { root, p1 } = fixture.projects.widgets;
  const baseLocal = cloneBase(fixture);
  const branchFrom = (files, message) => {
    git(root, "checkout", "-q", "--detach", p1);
    return commitFiles(root, files, message);
  };
  const cases = [
    [
      "未明列的混合檔",
      branchFrom(
        { "docs/x.md": "# 共用\n", "docs/y.md": "# 專案段落\n" },
        "two mixed docs",
      ),
      /docs\/y\.md\(mixed\)/,
    ],
    [
      "未知路徑",
      branchFrom(
        { "docs/x.md": "# 共用\n", "misc/notes.txt": "unclassified\n" },
        "unknown path",
      ),
      /misc\/notes\.txt\(unknown\)/,
    ],
    [
      "已發布資料",
      branchFrom(
        {
          "docs/x.md": "# 共用\n",
          "apps/db-migrator/migrations/base/20260901120000_data_old.js":
            "module.exports = { up: async () => { /* rewritten */ } };\n",
        },
        "rewrite published migration",
      ),
      /20260901120000_data_old\.js\(published-data\)/,
    ],
  ];
  for (const [label, commit, pattern] of cases) {
    const result = await run(
      contributeWith(fixture, baseLocal, commit, ["docs/x.md"]),
      createFakeGh().runExternal,
    );
    assertRejected(result, pattern);
    assert.doesNotMatch(result.stderr, /docs\/x\.md/, label);
    assertNothingPrepared(fixture, baseLocal);
  }
});

test("contribute --accept-mixed 指到非混合檔、不在差異內或大小寫不符的檔:明確報錯,不建工作樹", async () => {
  const fixture = createFixture();
  const { root } = fixture.projects.widgets;
  const baseLocal = cloneBase(fixture);
  const commit = commitFiles(
    root,
    {
      "packages/ui/src/spacing.ts": "export const gap = 4;\n",
      "packages/project-config/src/project/public.ts":
        "export const brand = 'widgets2';\n",
      "misc/notes.txt": "unclassified\n",
      "docs/x.md": "# 共用\n",
      "apps/db-migrator/migrations/base/20260901120000_data_old.js":
        "module.exports = { up: async () => { /* rewritten */ } };\n",
    },
    "listed by mistake",
  );
  for (const [listed, pattern] of [
    [
      "packages/ui/src/spacing.ts",
      /只能列混合檔:packages\/ui\/src\/spacing\.ts 是 common/,
    ],
    [
      "packages/project-config/src/project/public.ts",
      /只能列混合檔:packages\/project-config\/src\/project\/public\.ts 是 project/,
    ],
    ["misc/notes.txt", /只能列混合檔:misc\/notes\.txt 是 unknown/],
    [
      "apps/db-migrator/migrations/base/20260901120000_data_old.js",
      /只能列混合檔:apps\/db-migrator\/migrations\/base\/20260901120000_data_old\.js 是 published-data/,
    ],
    ["docs/missing.md", /docs\/missing\.md 不在來源 commit 的差異內/],
    // 路徑比對區分大小寫(Git 路徑本身區分大小寫)
    ["Docs/X.md", /Docs\/X\.md 不在來源 commit 的差異內/],
  ]) {
    assertRejected(
      await run(
        contributeWith(fixture, baseLocal, commit, ["docs/x.md", listed]),
        createFakeGh().runExternal,
      ),
      pattern,
    );
    assertNothingPrepared(fixture, baseLocal);
  }
});

test("contribute --accept-mixed 不接受二進位的混合檔,要求拆出人工處理", async () => {
  const fixture = createFixture();
  const { root } = fixture.projects.widgets;
  const baseLocal = cloneBase(fixture);
  const commit = commitFiles(
    root,
    {
      "packages/ui/src/spacing.ts": "export const gap = 4;\n",
      "docs/logo.png": "\u0000PNG\u0000binary\u0000",
    },
    "binary mixed doc",
  );
  assertRejected(
    await run(
      contributeWith(fixture, baseLocal, commit, ["docs/logo.png"]),
      createFakeGh().runExternal,
    ),
    /不接受二進位檔:docs\/logo\.png.*人工處理/,
  );
  assertNothingPrepared(fixture, baseLocal);
});

test("contribute --accept-mixed:混合檔改名(刪舊 + 加新)兩個路徑都要明列", async () => {
  const fixture = createFixture();
  const { root } = fixture.projects.widgets;
  // 底座與專案都已有同一份 docs/a.md,專案再把它改名
  git(fixture.base.src, "checkout", "-q", "main");
  commitFiles(fixture.base.src, { "docs/a.md": "# 共用\n" }, "base: docs");
  git(fixture.base.src, "push", "-q", "origin", "main");
  const baseLocal = cloneBase(fixture);
  commitFiles(root, { "docs/a.md": "# 共用\n" }, "sync docs");
  const commit = commitFiles(
    root,
    { "docs/a.md": null, "docs/b.md": "# 共用\n" },
    "rename docs",
  );

  for (const [listed, pattern] of [
    ["docs/b.md", /docs\/a\.md\(mixed\)/],
    ["docs/a.md", /docs\/b\.md\(mixed\)/],
  ]) {
    assertRejected(
      await run(
        contributeWith(fixture, baseLocal, commit, [listed]),
        createFakeGh().runExternal,
      ),
      pattern,
    );
    assertNothingPrepared(fixture, baseLocal);
  }

  const result = await run(
    contributeWith(fixture, baseLocal, commit, ["docs/a.md", "docs/b.md"]),
    createFakeGh().runExternal,
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(
    result.json.mixedReview.files.map(({ path: file, status }) => [
      file,
      status,
    ]),
    [
      ["docs/a.md", "D"],
      ["docs/b.md", "A"],
    ],
  );
});

/** 模擬 agent 整合時更新採用版本記錄。 */
function setAdoption(dir, tag, commit) {
  const file = path.join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.wowgoBase = { ...manifest.wowgoBase, tag, commit };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

test("整體演練:升級並整合 → 回收 common-only 修正 → 底座發布新版 → 再次升級;專案值、業務來源與替換頁保留,兩個版本都是真祖先", async () => {
  const fixture = createFixture();
  const { root, p1 } = fixture.projects.widgets;
  const show = (commit, file) => git(root, "show", `${commit}:${file}`);

  // 1. 升級 v0.2.0:button.ts 衝突,專案種子值被自動套入
  const first = await run(
    upgradeArgs(fixture, ["widgets"]),
    publishedReleaseGh().runExternal,
  );
  assert.equal(first.exitCode, 0, first.stderr);
  const wt1 = first.json.projects[0].worktree;
  assert.deepEqual(first.json.projects[0].conflicts, [
    "packages/ui/src/button.ts",
  ]);

  // 2. agent 明確整合衝突與被自動套入的專案值、更新 wowgoBase;合併 PR 只推到夾具的 bare remote
  writeFileSync(
    path.join(wt1, "packages/ui/src/button.ts"),
    "export const label = 'widgets';\nexport const variant = 'base-v1';\n",
  );
  writeFileSync(
    path.join(wt1, "apps/db-migrator/seeds/project/settings.ts"),
    "export const orgName = 'Widgets Org';\n",
  );
  setAdoption(wt1, "v0.2.0", fixture.base.b1);
  git(wt1, "add", "-A");
  git(wt1, "commit", "-q", "--no-edit");
  netGit(wt1, "push", "-q", "origin", "HEAD:main");
  const main1 = git(wt1, "rev-parse", "HEAD");
  assert.equal(
    git(root, "rev-list", "--parents", "-n", "1", main1),
    `${main1} ${p1} ${fixture.base.b1}`,
  );

  // 3. 另一份專案 checkout 做一個通用修正,準備回收到底座;原本的 root 維持舊的乾淨 checkout(仍記 v0.1.0)
  const other = cloneProject(fixture, "widgets", "widgets-other");
  const fix = commitFiles(
    other,
    { "packages/ui/src/spacing.ts": "export const gap = 4;\n" },
    "ui: shared spacing",
  );
  netGit(other, "push", "-q", "origin", "main");
  const baseLocal = cloneBase(fixture);
  const contribution = await run(
    [
      "contribute",
      "--project",
      other,
      "--commit",
      fix,
      "--base",
      baseLocal,
      "--worktree-root",
      fixture.worktreeRoot,
    ],
    createFakeGh().runExternal,
  );
  assert.equal(contribution.exitCode, 0, contribution.stderr);

  // 4. 使用者審查後合併並發布 v0.3.0(只在夾具的 bare remote;Release 由假 gh 回答,不代表真的發布)
  const wtBase = contribution.json.worktree;
  git(wtBase, "commit", "-q", "-m", `ui: shared spacing (acme/widgets@${fix})`);
  netGit(wtBase, "push", "-q", "origin", "HEAD:main");
  const b2 = git(wtBase, "rev-parse", "HEAD");
  git(wtBase, "tag", "-a", "v0.3.0", "-m", "v0.3.0");
  netGit(wtBase, "push", "-q", "origin", "refs/tags/v0.3.0");

  // 5. 從舊的 root checkout 再次升級到 v0.3.0:採用記錄以 origin/main(已是 v0.2.0)為準,只帶入回收的修正
  const rootPackage = readFileSync(path.join(root, "package.json"), "utf8");
  assert.equal(JSON.parse(rootPackage).wowgoBase.tag, "v0.1.0");
  const second = await run(
    upgradeArgs(fixture, ["widgets"], "v0.3.0"),
    publishedReleaseGh({ releases: { [`${BASE_REPOSITORY}#v0.3.0`]: {} } })
      .runExternal,
  );
  assert.equal(second.exitCode, 0, second.stderr);
  const upgrade2 = second.json.projects[0];
  assert.equal(upgrade2.state, "prepared");
  assert.deepEqual(upgrade2.adopted, {
    repository: BASE_REPOSITORY,
    tag: "v0.2.0",
    commit: fixture.base.b1,
  });
  assert.deepEqual(upgrade2.conflicts, []);
  assert.deepEqual(categories(upgrade2.files), {
    "packages/ui/src/spacing.ts": "common",
  });
  // 使用者原本的 checkout 不被修改
  assert.equal(git(root, "rev-parse", "HEAD"), p1);
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.equal(
    readFileSync(path.join(root, "package.json"), "utf8"),
    rootPackage,
  );
  setAdoption(upgrade2.worktree, "v0.3.0", b2);
  git(upgrade2.worktree, "add", "package.json");
  git(upgrade2.worktree, "commit", "-q", "--no-edit");
  netGit(upgrade2.worktree, "push", "-q", "origin", "HEAD:main");

  // 6. 最終 main:兩個底座版本都是真祖先,底座的 UI / API / seed 更新到位,專案內容保留
  netGit(root, "fetch", "-q", "origin");
  const finalMain = git(root, "rev-parse", "origin/main");
  for (const commit of [fixture.base.b1, b2]) {
    assert.equal(
      tryGit(root, "merge-base", "--is-ancestor", commit, finalMain).status,
      0,
    );
  }
  assert.equal(
    git(root, "rev-list", "--parents", "-n", "1", finalMain),
    `${finalMain} ${fix} ${b2}`,
  );
  assert.equal(
    show(finalMain, "packages/project-config/src/project/public.ts"),
    "export const brand = 'widgets';",
  );
  assert.equal(
    show(finalMain, "apps/db-migrator/seeds/project/settings.ts"),
    "export const orgName = 'Widgets Org';",
  );
  // 專案的業務來源與替換頁逐字保留;底座的 API / seed 與回收的修正逐字到位
  const expectedBytes = {
    ...Object.fromEntries(
      [
        "apps/api/src/project/orders/orders.module.ts",
        "apps/admin/src/app/project/page-replacements.ts",
        "apps/admin/src/pages/project/CustomUsersPage/CustomUsersPage.tsx",
      ].map((file) => [file, WIDGETS_SOURCES[file]]),
    ),
    ...Object.fromEntries(
      [
        "apps/api/src/auth/session.ts",
        "apps/db-migrator/seeds/base/roles.ts",
      ].map((file) => [file, BASE_V2_CHANGES[file]]),
    ),
    "packages/ui/src/spacing.ts": "export const gap = 4;\n",
  };
  for (const [file, bytes] of Object.entries(expectedBytes)) {
    assert.equal(`${show(finalMain, file)}\n`, bytes, file);
  }
  assert.match(show(finalMain, "packages/ui/src/button.ts"), /'widgets'/);
  assert.deepEqual(JSON.parse(show(finalMain, "package.json")).wowgoBase, {
    repository: httpsUrl(BASE_REPOSITORY),
    tag: "v0.3.0",
    commit: b2,
  });
  assert.equal(git(root, "rev-parse", "refs/tags/v0.2.0"), p1);
});

test("CLI:未知命令非零退出、stdout 為空", () => {
  const cli = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "run.mjs",
  );
  assert.ok(existsSync(cli));
  const result = spawnSync(process.execPath, [cli, "bogus"], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.notEqual(result.stderr, "");
});
