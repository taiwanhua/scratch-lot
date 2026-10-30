/**
 * `findRepoRoot`:hook 以被編輯檔案往上找到的 repo / worktree 根為工作目錄,不以 session 的 cwd 為準。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { findRepoRoot } from "./repo-root.mjs";

// 主 checkout(.git 是資料夾)底下有一個 worktree(.git 是檔案),worktree 裡有新增的 workspace
const sandbox = mkdtempSync(path.join(tmpdir(), "claude-hook-root-"));
const mainRepo = path.join(sandbox, "repo");
const worktree = path.join(mainRepo, ".claude", "worktrees", "wt-1");
const newPackage = path.join(worktree, "packages", "new-pkg", "src");
mkdirSync(path.join(mainRepo, ".git"), { recursive: true });
mkdirSync(path.join(mainRepo, "apps", "api", "src"), { recursive: true });
mkdirSync(newPackage, { recursive: true });
writeFileSync(
  path.join(worktree, ".git"),
  `gitdir: ${path.join(mainRepo, ".git", "worktrees", "wt-1")}\n`,
);

after(() => rmSync(sandbox, { recursive: true, force: true }));

test("主 checkout 內的檔案:回主 checkout 根", () => {
  assert.equal(
    findRepoRoot(path.join(mainRepo, "apps", "api", "src", "a.ts"), mainRepo),
    mainRepo,
  );
});

test("session 在主 checkout、編輯 worktree 裡的檔案:回 worktree 根", () => {
  assert.equal(
    findRepoRoot(path.join(newPackage, "index.ts"), mainRepo),
    worktree,
  );
});

test("相對路徑以 session 的 cwd 為基準解析", () => {
  assert.equal(
    findRepoRoot(
      path.join(".claude", "worktrees", "wt-1", "packages", "new-pkg", "x.ts"),
      mainRepo,
    ),
    worktree,
  );
  assert.equal(findRepoRoot("README.md", mainRepo), mainRepo);
});

test("往上找不到 .git:退回 session 的 cwd", () => {
  const outside = path.join(sandbox, "loose", "dir");
  mkdirSync(outside, { recursive: true });
  const cwd = path.join(sandbox, "loose");
  assert.equal(findRepoRoot(path.join(outside, "x.ts"), cwd), cwd);
});
